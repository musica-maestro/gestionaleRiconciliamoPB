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
# Mac dev: irrelevant. Ubuntu/Coolify deploy: gives Node more heap during Vite build (avoids OOM).
ENV CI=true
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm run build

# Production stage (develop on Mac, deploy on Ubuntu)
FROM node:18-alpine AS production

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