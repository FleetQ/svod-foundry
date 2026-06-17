# Svod Foundry MCP server image.
# The foundry orchestrates Docker on the host, so the container must be given access to the
# host Docker socket (see docker-compose.yml). It does NOT run untrusted code itself — it asks
# the host daemon to spin ephemeral sandbox containers (ADR-0003).
FROM node:22-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Build from source.
COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript@^6.0.3 && npx tsc -p tsconfig.json && npm prune --omit=dev

COPY skill ./skill

ENV SVOD_FOUNDRY_CONFIG=/app/config.json
CMD ["node", "dist/index.js"]
