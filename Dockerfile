# Build stage: install all deps (including devDeps) and compile
FROM node:18-alpine AS build
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Ubuntu/Coolify: gives Node more heap during Vite build (avoids OOM).
ENV CI=true
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm run build

# Production stage (develop on Mac, deploy on Ubuntu/Alpine)
FROM node:18-alpine AS production

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 remixuser

WORKDIR /app

# Copy built app artifacts from build stage
COPY --from=build --chown=remixuser:nodejs /app/build ./build
COPY --from=build --chown=remixuser:nodejs /app/public ./public
COPY --from=build --chown=remixuser:nodejs /app/package.json ./
COPY --from=build --chown=remixuser:nodejs /app/pnpm-lock.yaml ./

# Install prod-only deps fresh in this stage so pnpm resolves
# the correct platform-native binaries (no cross-stage symlink breakage)
RUN npm install -g pnpm && pnpm install --frozen-lockfile --prod

# Switch to non-root user
USER remixuser

EXPOSE 3000

ENV NODE_ENV=production
ENV APP_HOST=0.0.0.0
ENV APP_PORT=3000

CMD ["node", "build/server/index.js"]
