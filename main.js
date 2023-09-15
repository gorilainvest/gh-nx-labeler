import * as github from '@actions/github';
import nx from '@nx/devkit';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
const defaultProjectTypeAbbreviations = {
    "application": "app",
    "library": "lib",
    "language": "lang"
};
const defaultLabelPrefixDefinitions = {
    "app": {
        "color": "D4C5F9",
        "description": "Pull request affected the application"
    },
    "lang": {
        "color": "C2E0C6",
        "description": "Projects of this language were affected by the pull request"
    },
    "lib": {
        "color": "BFD4F2",
        "description": "Pull request affected the library"
    }
};
async function getAffectedProjects(nxBase, nxHead) {
    console.log('Getting affected projects names');
    const { stdout } = await execAsync(`yarn nx show projects --affected --base=${nxBase} ---head=${nxHead}`);
    return stdout.split('\n').filter(line => line.length > 0);
}
function getEnvironmentVariables() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw Error('GITHUB_TOKEN is required');
    }
    const allAffectedTag = process.env.ALL_AFFECTED_TAG;
    const labelPrefix = process.env.LABEL_PREFIX_DEFINITIONS
        ? JSON.parse(process.env.LABEL_PREFIX_DEFINITIONS)
        : defaultLabelPrefixDefinitions;
    const projectTypeAbbreviations = process.env.PROJECT_TYPE_ABBREVIATIONS
        ? JSON.parse(process.env.PROJECT_TYPE_ABBREVIATIONS)
        : defaultProjectTypeAbbreviations;
    const nxHead = process.env.NX_HEAD;
    const nxBase = process.env.NX_BASE;
    return {
        nxHead,
        nxBase,
        token,
        projectTypeAbbreviations,
        labelPrefix,
        allAffectedTag
    };
}
async function collectAffectedTags(allAffectedTag, nxBase, nxHead, projectTypeAbbreviations) {
    const tags = new Set();
    const projectGraph = await nx.createProjectGraphAsync();
    const affected = await getAffectedProjects(nxBase, nxHead);
    console.log('Affected projects: ', affected);
    const configurations = nx.readProjectsConfigurationFromProjectGraph(projectGraph).projects;
    if (affected.length === Object.keys(configurations).length) {
        tags.add(allAffectedTag);
    }
    else {
        for (const project of affected) {
            const config = configurations[project];
            for (const tag of config.tags) {
                const [tagPrefix, tagSuffix] = tag.split(':');
                if (projectTypeAbbreviations[tagPrefix]) {
                    tags.add(`${tagPrefix}:${tagSuffix}`);
                }
                else {
                    tags.add(tag);
                }
            }
            tags.add(`${projectTypeAbbreviations[config.projectType]}:${config.name}`);
        }
    }
    return tags;
}
async function fetchRepositoryLabels(octokit) {
    const repositoryLabels = new Set();
    let hasMorePages = true;
    let page = 1;
    while (hasMorePages) {
        const result = await octokit.rest.issues.listLabelsForRepo({
            owner: 'gorilainvest',
            repo: 'securities',
            per_page: 100,
            page
        });
        result.data.map(label => repositoryLabels.add(label.name));
        hasMorePages = result.data.length === 100;
        page++;
    }
    return repositoryLabels;
}
async function createMissingLabels(octokit, tags, existingLabels, labelPrefix) {
    for (const tag of tags) {
        if (!existingLabels.has(tag)) {
            const [tagPrefix] = tag.split(':');
            if (labelPrefix[tagPrefix]) {
                console.log(`Creating custom definition for label ${tag}`);
                await octokit.rest.issues.createLabel({
                    owner: 'gorilainvest',
                    repo: 'securities',
                    name: tag,
                    color: labelPrefix[tagPrefix].color,
                    description: labelPrefix[tagPrefix].description
                });
            }
        }
    }
}
export async function run() {
    const { nxBase, nxHead, token, allAffectedTag, projectTypeAbbreviations, labelPrefix } = getEnvironmentVariables();
    const octokit = github.getOctokit(token);
    const affectedTags = await collectAffectedTags(allAffectedTag, nxBase, nxHead, projectTypeAbbreviations);
    const repositoryLabels = await fetchRepositoryLabels(octokit);
    await createMissingLabels(octokit, affectedTags, repositoryLabels, labelPrefix);
    const { owner, repo, number } = github.context.issue;
    await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: number,
        labels: Array.from(affectedTags)
    });
}
run();
