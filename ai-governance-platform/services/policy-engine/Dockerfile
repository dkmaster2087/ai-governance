# Build from the repository root (npm workspaces):
#   docker build -f services/policy-engine/Dockerfile -t ai-gov-policy-engine .
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY services/policy-engine/package.json services/policy-engine/
RUN npm ci -w shared/types -w shared/utils -w services/policy-engine --include-workspace-root=false
COPY shared/types shared/types
COPY shared/utils shared/utils
COPY services/policy-engine services/policy-engine
RUN npm run build -w shared/types -w shared/utils -w services/policy-engine

FROM node:20-alpine
WORKDIR /repo
RUN apk add --no-cache curl
COPY package.json package-lock.json ./
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY services/policy-engine/package.json services/policy-engine/
RUN npm ci --omit=dev -w shared/types -w shared/utils -w services/policy-engine --include-workspace-root=false && npm cache clean --force
COPY --from=build /repo/shared/types/dist shared/types/dist
COPY --from=build /repo/shared/utils/dist shared/utils/dist
COPY --from=build /repo/services/policy-engine/dist services/policy-engine/dist
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1
USER node
CMD ["node", "services/policy-engine/dist/index.js"]
