# syntax=docker/dockerfile:1
# Keycloak with the Adili login and email themes (apps/keycloak-theme) and the Adili OTP
# authenticator (apps/keycloak-extension) installed:
#   docker build -f infra/docker/keycloak.Dockerfile -t adili/keycloak .
# Keep in step with .nvmrc (CI reads it).
ARG NODE_VERSION=24
# Keep in step with keycloak.version in apps/keycloak-extension/pom.xml.
ARG KEYCLOAK_VERSION=26.7.4
ARG MAVEN_IMAGE=maven:3.9-eclipse-temurin-21

FROM ${MAVEN_IMAGE} AS extension
WORKDIR /extension
COPY apps/keycloak-extension/pom.xml .
RUN --mount=type=cache,id=m2,target=/root/.m2 mvn -B -q -ntp dependency:go-offline
COPY apps/keycloak-extension/src src
# The unit tests run in CI (Keycloak workflow); the image only packages.
RUN --mount=type=cache,id=m2,target=/root/.m2 mvn -B -q -ntp -DskipTests package

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
COPY --from=extension /extension/target/adili-keycloak-extension.jar /opt/keycloak/providers/adili-extension.jar
# The file vault holds the extension's client secret (realm: ${vault.keycloak-extension-secret}).
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_VAULT=file
RUN mkdir -p /opt/keycloak/vault && /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION}
COPY --from=build /opt/keycloak/ /opt/keycloak/
# Mount the secrets here, one file per secret named <realm>_<key> (e.g. adili_keycloak-extension-secret).
# KC_VAULT again so `start-dev`, which rebuilds from the environment, keeps the vault.
ENV KC_VAULT=file KC_VAULT_DIR=/opt/keycloak/vault
