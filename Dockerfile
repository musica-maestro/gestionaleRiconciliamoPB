# Gestionale Mediazioni - Production image
# Node 20 LTS; Debian slim for @tailwindcss/oxide (linux-x64-gnu). Alpine/musl can fail with pnpm.
FROM node:20-slim AS build

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

# Production stage
FROM node:20-slim

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/build ./build
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

ENV PATH="/app/node_modules/.bin:$PATH"
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/', (r) => process.exit([200,302].includes(r.statusCode) ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["remix-serve", "build/server/index.js"]
