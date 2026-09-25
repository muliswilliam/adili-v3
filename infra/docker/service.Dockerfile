# syntax=docker/dockerfile:1
# Builds any NestJS service in the monorepo:
#   docker build -f infra/docker/service.Dockerfile --build-arg SERVICE=directory -t adili/directory .
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

# Reduce the repo to the service and the workspace packages it depends on.
FROM base AS prune
ARG SERVICE
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@^2 prune "@adili/${SERVICE}" --docker

FROM base AS build
ARG SERVICE
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter="@adili/${SERVICE}"
# Self-contained production install of the service and its workspace dependencies.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter="@adili/${SERVICE}" deploy --prod --legacy /app

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app .
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/health/live" || exit 1
CMD ["node", "--import", "@adili/telemetry/register", "dist/main.js"]
