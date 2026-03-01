FROM node:18-alpine AS build
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install
COPY . .
RUN pnpm run build
RUN pnpm prune --prod

FROM node:18-alpine
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
