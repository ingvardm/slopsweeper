# ---- dependencies (cached unless package*.json change) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- production image (Node 24 = Active LTS "Krypton"; Node 22 is now in
# maintenance mode and its bundled npm toolchain carries known critical CVEs,
# e.g. tar CVE-2026-59873 — see `docker scout cves`) ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SCORES_FILE=/app/data/scores.json
WORKDIR /app

# Patch OS packages, install su-exec for the entrypoint's privilege drop,
# then remove the npm toolchain from the runtime image.
# Runtime only needs `node server.js` (deps are prebuilt in the `deps` stage),
# and scout shows all remaining HIGH/MEDIUMs live in npm's bundled modules
# (brace-expansion, ip-address, tar, undici) with no fixed release shipped yet.
RUN apk upgrade --no-cache \
  && apk add --no-cache su-exec \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Non-root user `node` (uid 1000) ships with the official image.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js docker-entrypoint.sh ./
COPY public ./public

# Writable dir for the scores volume when running as `node`.
# NOTE: build-time chown is masked at runtime when a volume is mounted over
# /app/data, so docker-entrypoint.sh re-chowns the (mounted) dir on every boot.
RUN mkdir -p /app/data && chown -R node:node /app && chmod +x ./docker-entrypoint.sh
VOLUME ["/app/data"]
# Stay root through ENTRYPOINT so it can repair volume ownership, then it
# drops to `node` via su-exec before starting the app.
ENTRYPOINT ["./docker-entrypoint.sh"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health | grep -q '"ok":true' || exit 1

CMD ["node", "server.js"]
