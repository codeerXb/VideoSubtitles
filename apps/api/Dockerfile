FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @video-to-doc/api prisma:generate && pnpm --filter @video-to-doc/api build
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
