# Probaline collector for on-premises networks: receives syslog and reads log files; results stay in /data.
# Build from the repository root:  docker build -f collector/deploy/onprem/Dockerfile -t probaline-collector collector
FROM node:20-alpine AS build
WORKDIR /src
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund --ignore-scripts
COPY src ./src
RUN npx tsc -p . && npm prune --omit=dev --no-audit --no-fund

FROM node:20-alpine
RUN addgroup -S probaline && adduser -S probaline -G probaline && mkdir -p /data && chown probaline:probaline /data
WORKDIR /app
COPY --from=build /src/dist ./dist
COPY --from=build /src/node_modules ./node_modules
USER probaline
ENV DATA_DIR=/data SYSLOG_UDP_PORT=5514 SYSLOG_TCP_PORT=5514 FLUSH_SECONDS=300 REPORT_AT=05:30 REPORT_DAYS=30
EXPOSE 5514/udp 5514/tcp
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD test -f /data/status.json || exit 1
CMD ["node", "dist/onprem/server.js"]
