# ---- dependencies (cached unless package*.json change) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- production image ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SCORES_FILE=/app/data/scores.json
WORKDIR /app

# Non-root user `node` (uid 1000) ships with the official image.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY public ./public

# Writable dir for the scores volume when running as `node`.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health | grep -q '"ok":true' || exit 1

CMD ["node", "server.js"]
