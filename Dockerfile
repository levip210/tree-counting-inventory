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
# Standalone does not include node_modules/.bin; copy the prisma shim and put it on PATH
# so neither `npx prisma` nor a bare `prisma` lookup can fail at boot.
RUN mkdir -p /app/data /app/node_modules/.bin /usr/local/bin
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
RUN test -f ./node_modules/prisma/build/index.js \
  && test -f ./node_modules/.bin/prisma \
  && chmod +x ./node_modules/.bin/prisma ./node_modules/prisma/build/index.js \
  && printf '%s\n' '#!/bin/sh' 'exec node /app/node_modules/prisma/build/index.js "$@"' > /usr/local/bin/prisma \
  && chmod +x /usr/local/bin/prisma
ENV PATH="/app/node_modules/.bin:/usr/local/bin:${PATH}"
ENV DATABASE_URL="file:/app/data/app.db"
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
# Prisma CLI can keep the event loop open after migrate prints success, so `&& node server.js`
# never runs. Time-box migrate, ignore a non-zero/timeout exit, then exec the HTTP server.
CMD ["sh", "-c", "timeout -k 5 60 node ./node_modules/prisma/build/index.js migrate deploy || true; exec node server.js"]
