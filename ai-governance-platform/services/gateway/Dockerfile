# Build from the repository root (npm workspaces):
#   docker build -f services/gateway/Dockerfile -t ai-gov-gateway .
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY services/gateway/package.json services/gateway/
RUN npm ci -w shared/types -w shared/utils -w services/gateway --include-workspace-root=false
COPY shared/types shared/types
COPY shared/utils shared/utils
COPY services/gateway services/gateway
RUN npm run build -w shared/types -w shared/utils -w services/gateway

FROM node:20-alpine
WORKDIR /repo
RUN apk add --no-cache curl
COPY package.json package-lock.json ./
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY services/gateway/package.json services/gateway/
RUN npm ci --omit=dev -w shared/types -w shared/utils -w services/gateway --include-workspace-root=false && npm cache clean --force
COPY --from=build /repo/shared/types/dist shared/types/dist
COPY --from=build /repo/shared/utils/dist shared/utils/dist
COPY --from=build /repo/services/gateway/dist services/gateway/dist
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
USER node
CMD ["node", "services/gateway/dist/index.js"]
