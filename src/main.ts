import * as github from '@actions/github'
import * as core from '@actions/core'
import nx from '@nx/devkit'
import { exec } from 'child_process'
import { promisify } from 'util'

type LabelPrefixDefinition = {
  color: string
  description: string
}

type Octokit = ReturnType<typeof github.getOctokit>

const execAsync = promisify(exec)

async function getAffectedProjects(
  nxBase: string,
  nxHead: string
): Promise<string[]> {
  const { stdout } = await execAsync(
    `yarn nx show projects --affected --base=${nxBase} ---head=${nxHead}`
  )
  return stdout.split('\n').filter(line => line.length > 0)
}

function getEnvironmentVariables() {
  const token = core.getInput('GITHUB_TOKEN')
  if (!token) {
    throw Error('GITHUB_TOKEN is required')
  }

  const allAffectedTag = core.getInput('ALL_AFFECTED_TAG')
  const labelPrefix = JSON.parse(
    core.getInput('LABEL_PREFIX_DEFINITIONS')
  ) as Record<string, LabelPrefixDefinition>
  const projectTypeAbbreviations = JSON.parse(
    core.getInput('PROJECT_TYPE_ABBREVIATIONS')
  ) as Record<string, string>
  const nxHead = core.getInput('NX_HEAD')
  const nxBase = core.getInput('NX_BASE')

  return {
    nxHead,
    nxBase,
    token,
    projectTypeAbbreviations,
    labelPrefix,
    allAffectedTag
  }
}

async function collectAffectedTags(
  allAffectedTag: string,
  nxBase: string,
  nxHead: string,
  projectTypeAbbreviations: Record<string, string>
): Promise<Set<string>> {
  const tags = new Set<string>()
  const projectGraph = await nx.createProjectGraphAsync()
  const affected = await getAffectedProjects(nxBase, nxHead)
  const configurations =
    nx.readProjectsConfigurationFromProjectGraph(projectGraph).projects

  if (affected.length === Object.keys(configurations).length) {
    tags.add(allAffectedTag)
  } else {
    for (const project of affected) {
      const config = configurations[project]
      config.tags.forEach(tag => {
        const [tagPrefix, tagSuffix] = tag.split(':')
        if (projectTypeAbbreviations[tagPrefix]) {
          tags.add(`${tagPrefix}:${tagSuffix}`)
        } else {
          tags.add(tag)
        }
      })
      tags.add(`${projectTypeAbbreviations[config.projectType]}:${config.name}`)
    }
  }
  return tags
}

async function fetchRepositoryLabels(octokit: Octokit): Promise<Set<string>> {
  const repositoryLabels = new Set<string>()
  let hasMorePages = true
  let page = 1

  while (hasMorePages) {
    const result = await octokit.rest.issues.listLabelsForRepo({
      owner: 'gorilainvest',
      repo: 'securities',
      per_page: 100,
      page
    })
    result.data.map(label => repositoryLabels.add(label.name))
    hasMorePages = result.data.length === 100
    page++
  }

  return repositoryLabels
}

async function createMissingLabels(
  octokit: Octokit,
  tags: Set<string>,
  existingLabels: Set<string>,
  labelPrefix: Record<string, LabelPrefixDefinition>
) {
  for (const tag of tags) {
    if (!existingLabels.has(tag)) {
      const [tagPrefix] = tag.split(':')
      if (labelPrefix[tagPrefix]) {
        console.log(`Creating custom definition for label ${tag}`)
        await octokit.rest.issues.createLabel({
          owner: 'gorilainvest',
          repo: 'securities',
          name: tag,
          color: labelPrefix[tagPrefix].color,
          description: labelPrefix[tagPrefix].description
        })
      }
    }
  }
}

export async function run() {
  const {
    nxBase,
    nxHead,
    token,
    allAffectedTag,
    projectTypeAbbreviations,
    labelPrefix
  } = getEnvironmentVariables()
  const octokit = github.getOctokit(token)

  const affectedTags = await collectAffectedTags(
    allAffectedTag,
    nxBase,
    nxHead,
    projectTypeAbbreviations
  )
  const repositoryLabels = await fetchRepositoryLabels(octokit)

  await createMissingLabels(
    octokit,
    affectedTags,
    repositoryLabels,
    labelPrefix
  )

  const { owner, repo, number } = github.context.issue
  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: number,
    labels: Array.from(affectedTags)
  })
}
