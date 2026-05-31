# Dev image for the NestJS white-label service (hot reload via `nest start --watch`).
# Source is bind-mounted at runtime; node_modules lives in an anonymous volume so
# the container's Linux-built native deps (bcrypt) and the generated Prisma client
# are never shadowed by the host's macOS/arm64 copy.
FROM node:22-slim

WORKDIR /app

# openssl: required by Prisma. python3/make/g++: native addon build (bcrypt).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy the Prisma schema before install so the `postinstall` hook (prisma
# generate) can find it and emit the client into node_modules.
COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY . .

EXPOSE 4000

# Apply committed migrations, then start in watch mode.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run dev"]
