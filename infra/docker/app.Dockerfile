# syntax=docker/dockerfile:1
# Builds a TanStack Start app (portal, console, verify):
#   docker build -f infra/docker/app.Dockerfile --build-arg APP=portal -t adili/portal .
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS prune
ARG APP
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@^2 prune "@adili/${APP}" --docker

FROM base AS build
ARG APP
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter="@adili/${APP}"

# Nitro bundles the server and its dependencies into .output; nothing else is needed.
FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/${APP}/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/" || exit 1
CMD ["node", ".output/server/index.mjs"]
