# Probaline collector for on-premises networks: receives syslog and reads log files; results stay in /data.
# Build from the repository root (the collector carries the shared AI catalog from shared/catalog):
#   docker build -f collector/deploy/onprem/Dockerfile -t probaline-collector .
FROM node:20-alpine AS build
WORKDIR /src
# The shared catalog first: it has no dependencies, only a TypeScript build.
COPY shared/catalog/package.json shared/catalog/tsconfig.json ./shared/catalog/
COPY shared/catalog/src ./shared/catalog/src
RUN npx -y -p typescript@5.4 tsc -p shared/catalog
WORKDIR /src/collector
COPY collector/package.json collector/tsconfig.json ./
# --install-links copies the catalog into node_modules instead of linking it, so the runtime image needs nothing else.
RUN npm install --no-audit --no-fund --ignore-scripts --install-links
COPY collector/src ./src
RUN npx tsc -p . && npm prune --omit=dev --no-audit --no-fund --install-links

FROM node:20-alpine
RUN addgroup -S probaline && adduser -S probaline -G probaline && mkdir -p /data && chown probaline:probaline /data
WORKDIR /app
COPY --from=build /src/collector/dist ./dist
COPY --from=build /src/collector/node_modules ./node_modules
USER probaline
ENV DATA_DIR=/data SYSLOG_UDP_PORT=5514 SYSLOG_TCP_PORT=5514 FLUSH_SECONDS=300 REPORT_AT=05:30 REPORT_DAYS=30
EXPOSE 5514/udp 5514/tcp
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD test -f /data/status.json || exit 1
CMD ["node", "dist/onprem/server.js"]
