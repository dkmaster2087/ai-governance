FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY shared/types/package*.json ./shared/types/
COPY shared/utils/package*.json ./shared/utils/
COPY services/gateway/package*.json ./services/gateway/
COPY services/policy-engine/package*.json ./services/policy-engine/
COPY services/data-protection/package*.json ./services/data-protection/
COPY services/analytics/package*.json ./services/analytics/

RUN npm install

COPY shared/ ./shared/
COPY services/data-protection/ ./services/data-protection/

RUN npm run build -w @ai-governance/types
RUN npm run build -w @ai-governance/utils
RUN npm run build -w @ai-governance/data-protection

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/types ./shared/types
COPY --from=builder /app/shared/utils ./shared/utils
COPY --from=builder /app/services/data-protection/dist ./dist
COPY --from=builder /app/services/data-protection/package*.json ./

EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1
CMD ["node", "dist/index.js"]
