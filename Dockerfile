# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine AS base

# Install pnpm globally
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml for better caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies stage
FROM base AS dependencies
RUN pnpm install --frozen-lockfile --prod
RUN cp -R node_modules prod_node_modules
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS build
COPY . .
COPY --from=dependencies /app/node_modules ./node_modules
# Let Tailwind install the correct oxide binary for this platform (Linux in Docker).
# Avoid OOM in constrained CI/Coolify environments; non-interactive build.
ENV CI=true
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm run build

# Production stage
# Note: Image is large (~1GB+) due to LibreOffice. Prefer building in CI and pushing to a registry
# so the Coolify server doesn't run out of disk during "exporting layers".
FROM node:18-alpine AS production

# Install pnpm, LibreOffice (for DOCX→PDF in Flusso export), and fonts so PDF text renders (no white boxes)
# Liberation ≈ Arial/Helvetica; DejaVu = good Unicode; fontconfig so LibreOffice finds them
RUN npm install -g pnpm && apk add --no-cache \
    libreoffice \
    fontconfig \
    ttf-dejavu \
    font-liberation \
    && fc-cache -f

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 remixuser

WORKDIR /app

# Copy built application (Remix Vite outputs build/server/index.js + build/client/)
COPY --from=build --chown=remixuser:nodejs /app/build ./build
COPY --from=build --chown=remixuser:nodejs /app/public ./public
COPY --from=build --chown=remixuser:nodejs /app/package.json ./

# Copy production dependencies
COPY --from=dependencies --chown=remixuser:nodejs /app/prod_node_modules ./node_modules

# Switch to non-root user
USER remixuser

# Expose port
EXPOSE 3000

# Set NODE_ENV to production
ENV NODE_ENV=production
ENV APP_HOST=0.0.0.0
ENV APP_PORT=3000

# Start the application (matches package.json "start" script)
CMD ["node", "build/server/index.js"] 