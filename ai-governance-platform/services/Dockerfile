# The Probaline image. Build from the repository's app folder (npm workspaces):
#   docker build -f services/Dockerfile -t probaline .
#
# The product image runs the gateway (every check inside it) and reports. PROBALINE_ROLE picks what a container
# runs: all (default: both, for a customer's install), gateway, or reports (Cloud runs these apart). See
# scripts/build-service.mjs.
#
# What ships: V8 bytecode plus a small loader, on a distroless Node image. No source, no source maps, no npm,
# no node_modules, no shell, not root.

# The runtime image. Bytecode runs only on the Node that compiled it, so it's compiled in this same image.
ARG RUNTIME=gcr.io/distroless/nodejs24-debian13:nonroot

FROM node:24-trixie-slim AS bundle
ARG TARGET=probaline
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/catalog/package.json shared/catalog/
COPY shared/types/package.json shared/types/
COPY shared/utils/package.json shared/utils/
COPY shared/storage/package.json shared/storage/
COPY services/gateway/package.json services/gateway/
COPY services/analytics/package.json services/analytics/
RUN if [ "$TARGET" = probaline ]; then W="-w services/gateway -w services/analytics"; else W="-w services/$TARGET"; fi \
  && npm ci --include-workspace-root -w shared/catalog -w shared/types -w shared/utils -w shared/storage $W
COPY shared/catalog shared/catalog
COPY shared/types shared/types
COPY shared/utils shared/utils
COPY shared/storage shared/storage
COPY services/gateway services/gateway
COPY services/analytics services/analytics
COPY scripts/build-service.mjs scripts/
RUN npm run build -w shared/catalog -w shared/types -w shared/utils -w shared/storage \
  && node scripts/build-service.mjs ${TARGET} --out /out

FROM ${RUNTIME} AS compile
ARG TARGET=probaline
COPY --from=bundle --chown=65532:65532 /out/${TARGET} /app
RUN ["/nodejs/bin/node", "/app/compile.cjs", "/app"]

FROM ${RUNTIME}
ARG TARGET=probaline
LABEL org.opencontainers.image.title="${TARGET}" org.opencontainers.image.vendor="Probaline"
COPY --from=compile /app/*.jsc /app/loader.js /app/
WORKDIR /app
# The gateway listens on PORT; in the all role, reports listen on 127.0.0.1:3003 inside the container only.
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER 65532:65532
CMD ["/app/loader.js"]
