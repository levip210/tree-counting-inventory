FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Prisma generate (postinstall) needs openssl + schema.prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci || npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# Prisma CLI needs c12/effect/etc. (not under @prisma/). Collect the tree here
# so the runner can migrate without npx or a network install.
RUN node scripts/copy-prisma-runtime.cjs /app/node_modules /prisma-node-modules

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next standalone binds HOSTNAME; Railway needs a non-loopback listen address.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /prisma-node-modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts/prisma-migrate.cjs ./scripts/prisma-migrate.cjs
# Standalone does not include node_modules/.bin; copy the prisma shim and put it on PATH
# so neither `npx prisma` nor a bare `prisma` lookup can fail at boot.
RUN mkdir -p /app/data /app/node_modules/.bin /usr/local/bin
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
RUN test -f ./node_modules/prisma/build/index.js \
  && test -f ./node_modules/.bin/prisma \
  && chmod +x ./node_modules/.bin/prisma ./node_modules/prisma/build/index.js \
  && printf '%s\n' '#!/bin/sh' 'exec node /app/node_modules/prisma/build/index.js "$@"' > /usr/local/bin/prisma \
  && chmod +x /usr/local/bin/prisma
# Next standalone for a root app emits /app/server.js. Fail the image if it is nested.
RUN if [ -f ./server.js ]; then \
      echo "[build] standalone server.js at /app/server.js"; \
    else \
      echo "[build] server.js not at /app/server.js; searching:"; \
      find /app -name server.js -print; \
      ls -la /app; \
      exit 1; \
    fi
ENV PATH="/app/node_modules/.bin:/usr/local/bin:${PATH}"
ENV DATABASE_URL="file:/app/data/app.db"
EXPOSE 3000
# Prisma CLI often does not exit after a successful SQLite migrate, so a raw
# `node prisma ... migrate deploy && node server.js` never reaches the server
# (Railway SUCCESS + 502). prisma-migrate.cjs always returns, then exec replaces
# the shell with Next so it is PID 1. HOSTNAME is set inline because Railway
# injects a container hostname that would otherwise override ENV HOSTNAME.
CMD ["sh", "-c", "node ./scripts/prisma-migrate.cjs; HOSTNAME=0.0.0.0 exec node server.js"]
