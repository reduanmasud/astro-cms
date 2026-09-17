# Production image for @astro-cms/server.
#
# The server runs TypeScript directly (Node 24's built-in type stripping —
# there is no build step). That rules out `pnpm deploy`: it copies workspace
# packages instead of symlinking them, so @astro-cms/markdown's source ends
# up physically under node_modules/, and Node refuses to strip types for
# anything there (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING — a deliberate
# restriction with no override flag). A normal `pnpm install` keeps the
# workspace symlink to packages/markdown outside node_modules instead, so
# type stripping sees it as first-party code, same as in local dev.

FROM node:24-trixie-slim AS runtime

RUN npm install --global pnpm@12.4.1

WORKDIR /repo

# Manifests first so the install layer is cached until dependencies change.
# `--filter "@astro-cms/server..."` scopes the install to the server and
# its workspace dependency (@astro-cms/markdown) only — collab's and web's
# own dependencies (HocusPocus, React, Vite…) never enter this image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/collab/package.json apps/collab/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/markdown/package.json packages/markdown/
COPY tooling/eslint-config/package.json tooling/eslint-config/
RUN pnpm install --frozen-lockfile --prod --filter "@astro-cms/server..."

COPY apps/server apps/server
COPY packages/markdown packages/markdown

WORKDIR /repo/apps/server

ENV NODE_ENV=production
ENV DATA_DIR=/data
VOLUME /data

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "src/index.ts"]
