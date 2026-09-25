ARG NODE_VERSION=24.18.0

#
# --- base: Node + pnpm (version from package.json#packageManager) -----------
#

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

#
# --- install: full dependency tree for building ------------------------------
#

FROM base AS install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

#
# --- build: react-router build (client + SSR bundle) and server.ts -> ESM ----
#

FROM install AS build
COPY . .
RUN pnpm build

#
# --- prod-deps: runtime dependencies only ------------------------------------
#

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

#
# --- runtime: slim, non-root --------------------------------------------------
#

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 LOG_FORMAT=json
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
# Dataset for the default (in-memory) PokemonCatalog adapter.
COPY --chown=node:node data ./data
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "build/server.js"]
