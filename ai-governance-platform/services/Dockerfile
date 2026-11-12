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
  && node scripts/build-service.mjs ${TARGET} --out /out \
  && mkdir -p /data/objects /certs \
  && node -e "fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem').then(async (r) => { if (!r.ok) throw new Error(r.status); require('fs').writeFileSync('/certs/rds-global-bundle.pem', await r.text()); })"

# The dashboard, built for a customer-run install: the gateway serving it signs people in (VITE_AUTH_MODE=install).
# Cloud serves its own build from CloudFront; there, this copy is never used.
FROM node:24-trixie-slim AS dashboard
WORKDIR /repo
COPY package.json package-lock.json ./
COPY frontend/dashboard/package.json frontend/dashboard/
RUN npm ci --include-workspace-root -w frontend/dashboard
COPY frontend/dashboard frontend/dashboard
# Files the dashboard shows people to download (code snippets, scan scripts), embedded as text.
COPY packages/verify-identity/src packages/verify-identity/src
COPY packages/verify-identity/snippets packages/verify-identity/snippets
COPY collector/endpoint collector/endpoint
RUN cd frontend/dashboard && VITE_AUTH_MODE=install npx vite build --outDir /dashboard

FROM ${RUNTIME} AS compile
ARG TARGET=probaline
COPY --from=bundle --chown=65532:65532 /out/${TARGET} /app
RUN ["/nodejs/bin/node", "/app/compile.cjs", "/app"]

FROM ${RUNTIME}
ARG TARGET=probaline
LABEL org.opencontainers.image.title="${TARGET}" org.opencontainers.image.vendor="Probaline"
COPY --from=compile /app/*.jsc /app/loader.js /app/
COPY --from=dashboard /dashboard /app/dashboard
# Where archive files go with OBJECT_STORE=file. Owned by the app's user, so a volume mounted here is writable.
COPY --from=bundle --chown=65532:65532 /data /data
# Amazon RDS's certificate authorities, so a database in RDS is checked, not just encrypted
# (NODE_EXTRA_CA_CERTS=/app/certs/rds-global-bundle.pem with PGSSLMODE=verify-full; the AWS template sets both).
COPY --from=bundle /certs /app/certs
WORKDIR /app
# The gateway listens on PORT; in the all role, reports listen on 127.0.0.1:3003 inside the container only.
# DASHBOARD_DIR: served only when the install signs people in itself (install/dashboard.ts).
ENV NODE_ENV=production PORT=3000 DASHBOARD_DIR=/app/dashboard
EXPOSE 3000
USER 65532:65532
CMD ["/app/loader.js"]
