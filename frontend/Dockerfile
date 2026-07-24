FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json next.config.ts postcss.config.mjs components.json ./
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
RUN pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
EXPOSE 3001
CMD ["node", "server.js"]
