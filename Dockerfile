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
RUN mkdir -p /app/data \
  && test -f ./node_modules/prisma/build/index.js
ENV DATABASE_URL="file:/app/data/app.db"
EXPOSE 3000
# Do not use `npx prisma` / PATH `prisma` — standalone has no node_modules/.bin.
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy && node server.js"]
