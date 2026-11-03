FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/ledger.sqlite
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
