# --- Build stage ---
FROM node:22-alpine AS build

WORKDIR /app

# Install deps first (cacheable layer)
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install

# Copy source and build
COPY server/ server/
COPY web/ web/
COPY tsconfig.json* ./

ARG SENTRY_AUTH_TOKEN
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
RUN npm run build -w web
RUN npx -w server tsc

# --- Runtime stage ---
FROM node:22-alpine

WORKDIR /app

# Only production deps for server
COPY server/package.json server/
RUN cd server && npm install --omit=dev

# Copy built artifacts
COPY --from=build /app/server/dist server/dist/
COPY --from=build /app/web/dist web/dist/

# elections.db is mounted or downloaded at runtime
# Expected at /app/elections.db

ENV PORT=3000
EXPOSE 3000

# CWD = /app/server so serveStatic root "../web/dist" → /app/web/dist
WORKDIR /app/server

# Drop root. node:alpine ships a pre-created `node` user (uid 1000).
# The mounted elections.db on the host must be world-readable (chmod 0644)
# or owned by uid 1000 for this user to open it.
USER node

CMD ["node", "dist/index.js"]
