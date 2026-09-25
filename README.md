# Powers Tree Farm Counting

Tablet-first Progressive Web App for **Powers Tree Farm** (Lansing, NC), a wholesale Fraser Fir operation.

Workers tap a size-and-grade button. Each tap immediately saves **one tree** with the tablet’s exact local date and time.

This is **not** a full inventory-management system. It does two jobs well:

1. **Yard Receiving** — trees arriving at the loading yard (farm required)
2. **Shipping** — trees leaving the loading yard (no farm, customer, or order)

## Stack

- **Next.js 15** (App Router) + TypeScript
- **SQLite** via Prisma (WAL mode). Justified for a single-farm server: one process, several tablets, simple backups. Swap to Postgres later if you outgrow a single host.
- **PWA** service worker + fullscreen landscape manifest (Android tablets and iPads)
- **bcrypt** password and PIN hashing, HMAC PIN uniqueness, httpOnly session cookies
- Offline queue in **IndexedDB**, sync with `clientSyncId` dedupe

## Required secrets / environment

Copy `.env.example` to `.env` (never commit `.env`).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | SQLite path, relative to `prisma/`. Default `file:../data/app.db` |
| `AUTH_SECRET` | yes | Long random string (16+ chars) used to sign login cookies. `openssl rand -base64 48` |
| `PIN_PEPPER` | no | Extra HMAC secret for PIN uniqueness. Falls back to `AUTH_SECRET` |
| `APP_TIMEZONE` | no | Dashboard “today” / hourly buckets. Default `America/New_York` (Lansing, NC) |
| `ADMIN_RESET_KEY` | no | Unused by the website. CLI password reset does not need it |
| `NODE_ENV` | no | `production` on a real server |

Excel export uses an **API key you create in Admin**, stored as a bcrypt hash. It is not an env var.

## Local run

Requires Node.js 22+.

```bash
npm install
mkdir -p data
npx prisma migrate deploy
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

First visit shows **First administrator setup**. After that account exists, `/setup` is permanently disabled.

```bash
npm test          # hashing, first-admin lock, PIN uniqueness, count dedupe
npm run lint      # TypeScript
npm run build && npm start
```

## Deploy (VPS / Docker — recommended)

SQLite lives in a persistent volume. This is the intended production shape for a farm server.

```bash
export AUTH_SECRET="$(openssl rand -base64 48)"
docker compose up --build -d
```

The container listens on **port 3000**. Put Caddy or nginx in front with HTTPS.

Data file: Docker volume `ptf-data` → `/app/data/app.db`.

### Manual Node host

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
NODE_ENV=production AUTH_SECRET=… DATABASE_URL=file:../data/app.db npm start
```

### Why not Vercel by default?

Vercel’s filesystem is ephemeral. SQLite would reset on every deploy. Use a VPS, NAS, or Raspberry Pi on the farm network instead. A hosted Postgres (Neon, RDS) would be required for serverless — that is a database-provider change, not enabled in this repo.

## PWA on tablets

1. Open the site in Chrome (Android) or Safari (iPad).
2. Add to Home Screen.
3. Use landscape. The counting grid is built for landscape tablets.
4. Grant sound if the browser asks; vibration depends on the device.

## Security notes

- Passwords and PINs are bcrypt-hashed. Backups never include hashes.
- Count rows never store counter name, label, login number, account id, email, or device id.
- Login failures are generic and rate-limited (lockout after 5 failures / 15 minutes / IP).
- Changing email, password, Quick Login PIN reset, Excel keys, deleting counts, or wiping the site requires the **full admin password**.

See **[ADMIN.md](./ADMIN.md)** for the 20 operator how-tos.
