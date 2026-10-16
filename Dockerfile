# syntax=docker/dockerfile:1
# --- build: SvelteKit (adapter-node) ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime: server.js (SvelteKit handler + Socket.IO satu port) ---
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/app.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY server.js ./
COPY server ./server
COPY src/lib/shared ./src/lib/shared
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
