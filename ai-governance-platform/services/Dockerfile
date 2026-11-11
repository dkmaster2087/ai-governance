# One image recipe for every Probaline service. Build from this folder (npm workspaces):
#   docker build -f services/Dockerfile --build-arg SERVICE=gateway --build-arg PORT=3000 -t probaline-gateway .
#
# What ships: the service as V8 bytecode plus a small loader, on a distroless Node image. No source, no
# source maps, no npm, no node_modules, no shell, not root.

# The runtime image. Bytecode runs only on the Node that compiled it, so it's compiled in this same image.
ARG RUNTIME=gcr.io/distroless/nodejs24-debian13:nonroot

FROM node:24-trixie-slim AS bundle
ARG SERVICE
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY shared/storage/package.json shared/storage/
COPY services/${SERVICE}/package.json services/${SERVICE}/
RUN npm ci --include-workspace-root -w shared/types -w shared/utils -w shared/storage -w services/${SERVICE}
COPY shared/types shared/types
COPY shared/utils shared/utils
COPY shared/storage shared/storage
COPY services/${SERVICE} services/${SERVICE}
COPY scripts/build-service.mjs scripts/
RUN npm run build -w shared/types -w shared/utils -w shared/storage \
  && node scripts/build-service.mjs ${SERVICE} --out /out

FROM ${RUNTIME} AS compile
ARG SERVICE
COPY --from=bundle --chown=65532:65532 /out/${SERVICE} /app
RUN ["/nodejs/bin/node", "/app/compile.cjs", "/app"]

FROM ${RUNTIME}
ARG SERVICE
ARG PORT=3000
LABEL org.opencontainers.image.title="probaline-${SERVICE}" org.opencontainers.image.vendor="Probaline"
COPY --from=compile /app/app.jsc /app/loader.js /app/
WORKDIR /app
ENV NODE_ENV=production PORT=${PORT}
EXPOSE ${PORT}
USER 65532:65532
CMD ["/app/loader.js"]
