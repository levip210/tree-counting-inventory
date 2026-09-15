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
# Generated client engines only — a subpath, not a replacement of node_modules.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Never COPY this tree onto ./node_modules: that wipes Next standalone deps (502).
COPY --from=builder /prisma-node-modules /opt/prisma-node_modules
RUN mkdir -p /app/data \
  && test -f /app/server.js \
  && test -f /app/node_modules/next/package.json \
  && test -f /opt/prisma-node_modules/prisma/build/index.js \
  && node -e "require('next/package.json'); require('next/dist/server/next.js'); console.log('[build] standalone next ok')"
ENV DATABASE_URL="file:/app/data/app.db"
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
# prisma-migrate.cjs always exits; HOSTNAME inline because Railway injects a hostname.
CMD ["sh", "-c", "node ./scripts/prisma-migrate.cjs; HOSTNAME=0.0.0.0 exec node server.js"]
