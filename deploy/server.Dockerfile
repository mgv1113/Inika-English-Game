FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
RUN npm ci -w apps/server --include-workspace-root
COPY apps/server apps/server
RUN npm run build -w apps/server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production CONTENT_DIR=/app/content/questions
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci -w apps/server --omit=dev && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY content content
WORKDIR /app/apps/server
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
