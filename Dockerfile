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
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts/prisma-migrate.cjs ./scripts/prisma-migrate.cjs
# Generated Prisma client engines. This is a subpath copy and does not replace node_modules.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Keep Prisma CLI out of ./node_modules replacement: a directory COPY onto
# ./node_modules wipes Next standalone packages and the HTTP server never starts.
COPY --from=builder /prisma-node-modules /opt/prisma/node_modules
# Merge Prisma packages into standalone node_modules without deleting Next/react/etc.
RUN mkdir -p /app/data /app/node_modules/.bin /usr/local/bin \
  && cp -a /opt/prisma/node_modules/. /app/node_modules/ \
  && ln -sf /opt/prisma/node_modules/prisma/build/index.js /app/node_modules/.bin/prisma \
  && printf '%s\n' '#!/bin/sh' 'exec node /opt/prisma/node_modules/prisma/build/index.js "$@"' > /usr/local/bin/prisma \
  && chmod +x /usr/local/bin/prisma /app/node_modules/.bin/prisma \
  && test -f /app/server.js \
  && test -f /opt/prisma/node_modules/prisma/build/index.js \
  && node -e "require('next'); require('react'); console.log('[build] standalone runtime ok')"
ENV PATH="/app/node_modules/.bin:/usr/local/bin:${PATH}"
ENV DATABASE_URL="file:/app/data/app.db"
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
# Time-box migrate (Prisma CLI can hang after success), then exec Next as PID 1.
# HOSTNAME is set inline because Railway injects a container hostname.
CMD ["sh", "-c", "timeout -k 5 60 node /opt/prisma/node_modules/prisma/build/index.js migrate deploy || true; HOSTNAME=0.0.0.0 exec node server.js"]
