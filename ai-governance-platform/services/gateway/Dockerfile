FROM node:20-alpine AS builder
WORKDIR /app

# Copy all package manifests for layer caching
COPY package*.json ./
COPY shared/types/package*.json ./shared/types/
COPY shared/utils/package*.json ./shared/utils/
COPY services/gateway/package*.json ./services/gateway/
COPY services/policy-engine/package*.json ./services/policy-engine/
COPY services/data-protection/package*.json ./services/data-protection/
COPY services/analytics/package*.json ./services/analytics/

# Install all workspace deps at root (creates node_modules symlinks)
RUN npm install

# Copy source
COPY shared/ ./shared/
COPY services/gateway/ ./services/gateway/

# Build shared packages first, then service
RUN npm run build -w @ai-governance/types
RUN npm run build -w @ai-governance/utils
RUN npm run build -w @ai-governance/gateway

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy root node_modules (contains workspace symlinks to shared packages)
COPY --from=builder /app/node_modules ./node_modules
# Copy shared package dist so symlinks resolve
COPY --from=builder /app/shared/types ./shared/types
COPY --from=builder /app/shared/utils ./shared/utils
# Copy service dist
COPY --from=builder /app/services/gateway/dist ./dist
COPY --from=builder /app/services/gateway/package*.json ./

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
