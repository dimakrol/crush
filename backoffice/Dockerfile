# Dev image for the backoffice (NestJS server + Vite/react-admin client in one
# process tree). Source is bind-mounted at runtime; node_modules lives in a
# separate volume so the container's Linux install isn't shadowed by the host's
# macOS/arm64 copy. That volume persists across rebuilds, so
# docker-entrypoint.sh re-runs `npm ci` when package-lock.json changes.
#
# trixie, not the `-slim` default (bookworm) the other services use:
# better-sqlite3 ships its prebuilt binaries inside the npm tarball rather than
# compiling on install, and the linux-arm64 one is linked against GLIBC_2.38.
# Bookworm has 2.36, so `require('better-sqlite3')` dies with ERR_DLOPEN_FAILED.
# Trixie has 2.41.
FROM node:22-trixie-slim

WORKDIR /app

# Build toolchain for the native addons compiled during `npm ci`
# (better-sqlite3 and bcrypt).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# 4000 = Nest, the only port anyone talks to. The Vite dev server (5175) is
# reached through Nest's dev proxy, so it is deliberately not exposed.
EXPOSE 4000

# Entrypoint self-heals the node_modules volume before running the CMD.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "dev"]
