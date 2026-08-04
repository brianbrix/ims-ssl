FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache bash curl python3 make g++

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV STORAGE_ROOT=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts

EXPOSE 3001
VOLUME ["/data"]

CMD ["node", "server/index.js"]
