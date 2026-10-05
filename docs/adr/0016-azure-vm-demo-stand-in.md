# ADR-016: Azure VM as a credit-funded stand-in for the Dokploy demo host

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-012](0012-single-polyglot-monorepo.md), [architecture §12](../architecture/README.md#12-deployment), [infra/azure](../../infra/azure/README.md)

## Context

ADR-012 #4 and architecture §12 describe the hackathon host as Dokploy / Swarm: every app, service and mock is a container image, deployed from its own path. The team needed a public HTTPS demo before that host existed. Azure credits were available. Entra ID was not an option: Keycloak stays the identity provider (ADR-004).

## Decision

1. **Azure is a stand-in, not the demo architecture and not production.** One Ubuntu VM in South Africa North runs the same Compose file as local (`postgres`, Keycloak `adili/keycloak:dev`, SeaweedFS, and the rest). Apps and NestJS services run with `pnpm dev` under systemd, behind Caddy + Let's Encrypt on the `*.cloudapp.azure.com` hostname.
2. **Terraform manages Azure resources only** (resource group, VM, NSG, public IP). Compose, Caddy, migrate and the apps stay scripts. State is local; CI does not `terraform apply`.
3. **Pushes to `main` update that VM** after CI succeeds: rsync, then `deploy.sh` as `adili`. Privileged restarts go through a root-owned helper outside the synced tree. No re-seed, no certificate re-issue.
4. **Dokploy with per-app images remains the intended hackathon deploy.** Production remains Kenyan DCs (RKE2, Ceph), not Azure.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Wait for Dokploy** | No public URL for the 9 Oct pitch until that host is up. |
| **Replace Keycloak with Entra ID** | Breaks the realm, OTP extension and theme the specs assume (ADR-004). |
| **AKS / image-per-app on Azure** | Extra cost and time; the credit quota is 4 vCPU in the region. |

## Consequences

**Positive**
- A stable HTTPS URL for portal, console, verify and Keycloak while Dokploy is unfinished.

**Negative / risks**
- Apps are Vite / Nest dev servers, not the CI-built images ADR-012 describes.
  - *Update 2026-10-05 (#371):* portal, console and verify now run from their production builds (`.output/server/index.mjs`, built by `deploy.sh`, started by `infra/azure/run-apps.sh`): over the network, Vite's unbundled modules held up hydration by seconds. Services and mocks are still `pnpm dev`, and these are still not the per-app images.
- Data lives on the VM OS disk (Docker volumes). `terraform destroy` wipes it. Nightly dumps and a restore check are `infra/azure/backup-databases.sh` and `verify-restore.sh` (#370); they are not an off-site copy.
- South Africa North is not "self-hosted in Kenya". Synthetic demo data only.
