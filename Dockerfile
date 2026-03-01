# Use Debian-based image so @tailwindcss/oxide optional bindings (linux-x64-gnu) install correctly.
# Alpine (musl) often fails to get oxide-linux-x64-musl with pnpm.
FROM node:18-slim AS build
RUN apt-get update -y && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
RUN pnpm prune --prod

FROM node:18-slim
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 3000
ENV NODE_ENV=production
ENV APP_HOST=0.0.0.0
ENV APP_PORT=3000
CMD ["node", "build/server/index.js"]
