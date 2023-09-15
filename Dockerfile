FROM node:18-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

RUN npm run build

CMD ["sh", "-c", "cp /usr/src/app/main.js . && cp /usr/src/app/node_modules/* node_modules && node main.js"]
