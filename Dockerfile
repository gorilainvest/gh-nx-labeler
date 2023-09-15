FROM node:18-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

RUN npm run build

CMD ["node", "/usr/src/app/main.js"]
