# Dev image for the NestJS platform backend (hot reload via `nest start --watch`).
# Source is bind-mounted at runtime; node_modules lives in an anonymous volume
# so the container's Linux-built native deps (e.g. bcrypt) are never shadowed by
# the host's macOS/arm64 copy.
FROM node:22-slim

WORKDIR /app

# Build toolchain for native addons (bcrypt) compiled during `npm ci`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
