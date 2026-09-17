# Production image for @astro-cms/web: a Vite build, served as static files
# by nginx (unlike dev, where Vite itself serves and proxies /api).

FROM node:24-trixie-slim AS build

RUN npm install --global pnpm@12.4.1

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/collab/package.json apps/collab/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/markdown/package.json packages/markdown/
COPY tooling/eslint-config/package.json tooling/eslint-config/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @astro-cms/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O- http://localhost/ >/dev/null || exit 1
