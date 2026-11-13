# Probaline connector: runs inside the company network, connects out to the gateway over HTTPS.
# Build from the platform folder (npm workspaces):
#   docker build -f connector/Dockerfile -t probaline/connector:0.1.0 .
#
# What ships: the connector as V8 bytecode plus a small loader, on a distroless Node image. No source, no npm,
# no node_modules, no shell, not root.
ARG RUNTIME=gcr.io/distroless/nodejs24-debian13:nonroot

FROM node:25-trixie-slim AS bundle
WORKDIR /repo
COPY package.json package-lock.json ./
COPY connector/package.json connector/
RUN npm ci --include-workspace-root -w connector
COPY connector connector
COPY scripts/build-service.mjs scripts/
RUN node scripts/build-service.mjs connector --out /out

# Bytecode runs only on the Node that compiled it, so it's compiled in the runtime image itself.
FROM ${RUNTIME} AS compile
COPY --from=bundle --chown=65532:65532 /out/connector /app
RUN ["/nodejs/bin/node", "/app/compile.cjs", "/app"]

FROM ${RUNTIME}
LABEL org.opencontainers.image.title="probaline-connector" org.opencontainers.image.vendor="Probaline" \
      org.opencontainers.image.description="Carries MCP calls from Probaline to APIs inside your network. Connects out only."
COPY --from=compile /app/app.jsc /app/loader.js /app/
WORKDIR /app
ENV NODE_ENV=production
USER 65532:65532
ENTRYPOINT ["/nodejs/bin/node", "/app/loader.js"]
