# Build from the repository root (npm workspaces):
#   docker build -f services/reporting-agent/Dockerfile -t ai-gov-reporting-agent .
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY services/reporting-agent/package.json services/reporting-agent/
RUN npm ci -w shared/types -w shared/utils -w services/reporting-agent --include-workspace-root=false
COPY shared/types shared/types
COPY shared/utils shared/utils
COPY services/reporting-agent services/reporting-agent
RUN npm run build -w shared/types -w shared/utils -w services/reporting-agent

FROM node:20-alpine
WORKDIR /repo
RUN apk add --no-cache curl
COPY package.json package-lock.json ./
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY services/reporting-agent/package.json services/reporting-agent/
RUN npm ci --omit=dev -w shared/types -w shared/utils -w services/reporting-agent --include-workspace-root=false && npm cache clean --force
COPY --from=build /repo/shared/types/dist shared/types/dist
COPY --from=build /repo/shared/utils/dist shared/utils/dist
COPY --from=build /repo/services/reporting-agent/dist services/reporting-agent/dist
ENV NODE_ENV=production
ENV REPORTING_AGENT_PORT=3005
EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3005/health || exit 1
USER node
CMD ["node", "services/reporting-agent/dist/index.js"]
