# Dev image for the crash-pilot Vite/React frontend (hot reload via `vite`).
# Source is bind-mounted at runtime; node_modules lives in an anonymous volume
# so the host copy never shadows the container's install. `--host 0.0.0.0`
# makes the dev server reachable from outside the container.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5174

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
