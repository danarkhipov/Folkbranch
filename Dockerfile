FROM node:24-slim AS build
WORKDIR /app
# Compiles better-sqlite3 when no prebuilt binary matches the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 HOSTNAME=0.0.0.0
# Measured on a family of 1000: about a third less memory, with no slower answers. The ceiling leaves room for the largest upload.
ENV MALLOC_ARENA_MAX=2 MALLOC_TRIM_THRESHOLD_=65536 MALLOC_MMAP_THRESHOLD_=65536 NODE_OPTIONS="--max-semi-space-size=4 --max-old-space-size=256"
COPY --chown=node:node --from=build /app/.next/standalone ./
COPY --chown=node:node --from=build /app/.next/static ./.next/static
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/drizzle ./drizzle
COPY --chown=node:node scripts/folkbranch.mjs ./folkbranch.mjs
# The standalone build keeps the driver out of sight; the server commands need to find it, and the build fails if they cannot.
RUN cd node_modules && ln -s .pnpm/better-sqlite3@*/node_modules/better-sqlite3 better-sqlite3 && cd .. && node -e "require('better-sqlite3')"
# The folder is made here so a new Docker volume inherits it. Railway refuses a VOLUME line, so the volume is declared where the app is run.
RUN mkdir -p /data && chown node:node /data
# Starts as root only to hand the volume over; the app itself runs as node. Whatever goes wrong inside stays inside.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
