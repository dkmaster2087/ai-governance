# Probaline collector: finds AI usage in your logs. One image for every way it runs:
#   on premises    (default)  receives syslog and watches a folder; results stay in /data
#   Azure / Google cloud-job  one run reading exported logs from a bucket (see collector/README.md)
#   by hand        collect / report, e.g. docker exec <container> /nodejs/bin/node /app/loader.js report --out /data
#
# Build from the platform folder (npm workspaces):
#   docker build -f collector/Dockerfile -t probaline/collector:0.1.0 .
#
# What ships: the collector as V8 bytecode plus a small loader, on a distroless Node image. No source, no npm,
# no node_modules, no shell, not root.
ARG RUNTIME=gcr.io/distroless/nodejs24-debian13:nonroot

FROM node:24-trixie-slim AS bundle
WORKDIR /repo
COPY package.json package-lock.json ./
COPY collector/package.json collector/
RUN npm ci --include-workspace-root -w collector
COPY collector collector
COPY scripts/build-service.mjs scripts/
RUN node scripts/build-service.mjs collector --out /out && mkdir -p /data

# Bytecode runs only on the Node that compiled it, so it's compiled in the runtime image itself.
FROM ${RUNTIME} AS compile
COPY --from=bundle --chown=65532:65532 /out/collector /app
RUN ["/nodejs/bin/node", "/app/compile.cjs", "/app"]

FROM ${RUNTIME}
LABEL org.opencontainers.image.title="probaline-collector" org.opencontainers.image.vendor="Probaline" \
      org.opencontainers.image.description="Finds AI usage in your network and cloud logs. Results stay with you."
COPY --from=compile /app/app.jsc /app/loader.js /app/
COPY --from=bundle --chown=65532:65532 /data /data
WORKDIR /app
USER 65532:65532
ENV NODE_ENV=production DATA_DIR=/data SYSLOG_UDP_PORT=5514 SYSLOG_TCP_PORT=5514 FLUSH_SECONDS=300 REPORT_AT=05:30 REPORT_DAYS=30
EXPOSE 5514/udp 5514/tcp
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD ["/nodejs/bin/node", "-e", "require('fs').accessSync('/data/status.json')"]
ENTRYPOINT ["/nodejs/bin/node", "/app/loader.js"]
CMD ["serve"]
