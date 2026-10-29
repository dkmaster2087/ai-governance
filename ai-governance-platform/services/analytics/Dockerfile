# Build from the repository root (npm workspaces):
#   docker build -f services/analytics/Dockerfile -t ai-gov-analytics .
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY services/analytics/package.json services/analytics/
RUN npm ci -w shared/types -w shared/utils -w services/analytics --include-workspace-root=false
COPY shared/types shared/types
COPY shared/utils shared/utils
COPY services/analytics services/analytics
RUN npm run build -w shared/types -w shared/utils -w services/analytics

FROM node:20-alpine
WORKDIR /repo
RUN apk add --no-cache curl
COPY package.json package-lock.json ./
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY services/analytics/package.json services/analytics/
RUN npm ci --omit=dev -w shared/types -w shared/utils -w services/analytics --include-workspace-root=false && npm cache clean --force
COPY --from=build /repo/shared/types/dist shared/types/dist
COPY --from=build /repo/shared/utils/dist shared/utils/dist
COPY --from=build /repo/services/analytics/dist services/analytics/dist
ENV NODE_ENV=production
ENV PORT=3003
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3003/health || exit 1
USER node
CMD ["node", "services/analytics/dist/index.js"]
