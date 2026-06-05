# syntax=docker/dockerfile:1

# ── Build-Stage ──────────────────────────────────────────────────────────────
# Debian-basiert (nicht alpine/musl), damit das native better-sqlite3 sauber baut.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Build-Tools für native Module (better-sqlite3); prebuild-install nutzt sie als Fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime-Stage ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATABASE_PATH=/data/vm.sqlite

# Kompilierte node_modules (inkl. better-sqlite3-Binary) + Build aus der Builder-Stage.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# SQLite-Datei liegt im Volume, damit sie Updates/Neustarts überlebt.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 4321
CMD ["node", "dist/server/entry.mjs"]
