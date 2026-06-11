# Dev image for the NestJS platform backend (hot reload via `nest start --watch`).
# Source is bind-mounted at runtime; node_modules lives in a separate volume so
# the container's Linux install isn't shadowed by the host's macOS/arm64 copy.
# That volume persists across rebuilds, so docker-entrypoint.sh re-runs `npm ci`
# when package-lock.json changes — see the script for the full rationale.
FROM node:22-slim

WORKDIR /app

# Build toolchain for any native addons compiled during `npm ci`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4000

# Entrypoint self-heals the node_modules volume before running the CMD.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "dev"]
