# syntax=docker/dockerfile:1
# Keycloak with the Adili login theme (apps/keycloak-theme) installed:
#   docker build -f infra/docker/keycloak.Dockerfile -t adili/keycloak .
ARG NODE_VERSION=24
ARG KEYCLOAK_VERSION=26.7.4

FROM node:${NODE_VERSION}-bookworm-slim AS theme
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# keycloakify packages the theme as a provider JAR with Maven.
RUN apt-get update \
  && apt-get install -y --no-install-recommends maven openjdk-17-jdk-headless \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@^2 prune @adili/keycloak-theme --out-dir /pruned
WORKDIR /pruned
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@adili/keycloak-theme^... \
  && pnpm --filter @adili/keycloak-theme build-keycloak-theme

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION} AS build
COPY --from=theme /pruned/apps/keycloak-theme/dist_keycloak/keycloak-theme-for-kc-all-other-versions.jar /opt/keycloak/providers/adili-theme.jar
ENV KC_DB=postgres KC_HEALTH_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION}
COPY --from=build /opt/keycloak/ /opt/keycloak/
