FROM node:20-alpine AS base
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=base /app/dist ./dist

EXPOSE 3001
EXPOSE 3002

CMD ["node", "dist/index.js"]
