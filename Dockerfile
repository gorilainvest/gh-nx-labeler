FROM node:18-slim

COPY package.json package-lock.json ./

RUN npm install

COPY . .

RUN npm run build

CMD ["node", "main.js"]
