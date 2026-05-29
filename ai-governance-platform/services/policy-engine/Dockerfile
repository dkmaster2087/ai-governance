FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY ../../shared ./shared
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm ci --production
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1
USER node
CMD ["node", "dist/index.js"]
