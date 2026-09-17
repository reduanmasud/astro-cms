# Production image for @astro-cms/collab — the HocusPocus live-collaboration
# server (docs/adr/0016-collaboration-service.md). Runs TypeScript directly,
# same as the server: no build step.

FROM node:24-trixie-slim AS deploy

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

RUN pnpm --filter @astro-cms/collab deploy --prod /deploy

FROM node:24-trixie-slim AS runtime
WORKDIR /app
COPY --from=deploy /deploy .

ENV NODE_ENV=production
EXPOSE 1234

CMD ["node", "src/main.ts"]
