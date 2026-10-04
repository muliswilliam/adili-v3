# Azure demo host

This is **not** the production architecture. The platform design is:

| Environment | Where | How |
|---|---|---|
| Local | laptop | `pnpm infra:up` (Compose) |
| Hackathon demo | 3-node Dokploy / Swarm + Traefik | per-app container images (ADR-012) |
| Hackathon stand-in | Azure VM, South Africa North | Compose for infra; `pnpm dev` for apps (ADR-016) |
| EACC production | Kenyan DCs (Konza / Nairobi), RKE2, Ceph | Helm, not Azure |

Azure is a **credit-funded stand-in for the Dokploy demo host** ([ADR-016](../../docs/adr/0016-azure-vm-demo-stand-in.md)). It runs the same Compose file and the same Keycloak image (`adili/keycloak:dev`, realm `adili`, OTP extension, theme). Apps on this VM are `pnpm dev`, not the CI-built images. Do not replace Keycloak with Microsoft Entra ID.

## What is Terraform vs what is not

Terraform in this directory creates the **Azure resources**. The demo **stack** on the VM is still Compose + Caddy + `pnpm`, driven by scripts.

| In Terraform | On the VM (scripts / CD) |
|---|---|
| Resource group, VNet, NSG | Compose: Postgres, Valkey, RabbitMQ, Temporal, OpenBao, SeaweedFS, Keycloak |
| Ubuntu 24.04 VM (`Standard_E4s_v5`) | Caddy + Let's Encrypt (`enable-https.sh` once) |
| Static public IP + DNS label | App `.env` files (`configure-app-env.sh`) |
| Basic ACR + `AcrPull` (unused until we push images) | `pnpm bootstrap`, `db:migrate`, systemd `adili-apps` |

State is **local** (`terraform.tfstate`, gitignored). CI does not `terraform apply`. After CI on `main`, the workflow rsyncs the repo onto the existing VM and runs `deploy.sh`.

## What Terraform creates

- Resource group, VNet, NSG
- Ubuntu 24.04 VM (default `Standard_E4s_v5`, 4 vCPU / 32 GiB: Keycloak + Temporal + Postgres + the apps). Credit subscriptions often cap South Africa North at 4 cores, which blocks `Standard_D8s_v5`.
- Static public IP with an Azure DNS label
- Azure Container Registry (for later image push; Compose can still build on the VM)
- System-assigned identity with `AcrPull`
- cloud-init: Docker, Compose, Caddy, `/etc/adili/public.env`

Postgres, Valkey, RabbitMQ, Temporal, OpenBao, SeaweedFS and Keycloak stay **in Compose**, so the local `.env.example` wiring still works.

## Cost (order of magnitude)

A `Standard_E4s_v5` in South Africa North plus a 128 GiB Premium disk and a Basic ACR is the bulk of spend (less than the original 8-vCPU `D8s_v5`). Stop or `terraform destroy` when you are not demoing. A `Standard_D4s_v5` (16 GiB) will struggle once Keycloak, Temporal and ClamAV are up.

## Apply

```sh
az login
az account show   # confirm the subscription with credits
# put that id in terraform.tfvars as subscription_id

cd infra/azure
cp terraform.tfvars.example terraform.tfvars
# paste your ssh-ed25519 public key; set allowed_ssh_cidrs to your /32

terraform init
terraform plan
terraform apply
terraform output
```

SSH as `adili@<fqdn>`. Put the repo on the box:

```sh
# from your laptop
rsync -a --exclude node_modules --exclude .git ./ adili@<fqdn>:/opt/adili/
# on the VM
sudo /opt/adili/infra/azure/bootstrap-stack.sh
```

`bootstrap-stack.sh` rewrites portal/console redirect URIs in the Keycloak realm to the public URLs, then starts Compose with `docker-compose.azure.yml` so `KC_HOSTNAME`, `ADILI_PORTAL_URL` and `ADILI_CONSOLE_URL` match.

Then on the VM, from `/opt/adili`:

```sh
pnpm bootstrap
./infra/azure/configure-app-env.sh
pnpm db:migrate
pnpm db:seed
sudo cp infra/azure/adili-apps.service /etc/systemd/system/
sudo systemctl enable --now adili-apps
sudo ./infra/azure/enable-https.sh
./infra/azure/configure-app-env.sh
sudo systemctl restart adili-apps
```

Live host (this subscription): `https://adili-demo.southafricanorth.cloudapp.azure.com`

## HTTPS

Caddy terminates TLS with Let's Encrypt. Set `letsencrypt_email` in `terraform.tfvars`.

- No custom domain: `https://<dns_label>.<region>.cloudapp.azure.com` (portal on 443), console `:3020`, verify `:3030`, Keycloak `:8080`. Run `sudo /opt/adili/infra/azure/enable-https.sh` on the VM, then `configure-app-env.sh` and restart `adili-apps`.
- Custom domain: A records for `portal`, `console`, `verify` and `auth` at `terraform output -raw public_ip`. Set `custom_domain` and re-apply. NSG then only needs 22/80/443.

## CI/CD (after CI on `main`)

`.github/workflows/azure-demo.yml` deploys when the CI workflow succeeds on `main` (`workflow_run`) and on `workflow_dispatch`:

1. rsync the checkout to `/opt/adili` (keeps `.env`, `node_modules`, `.venv`)
2. `/opt/adili/infra/azure/deploy.sh` as `adili` - Compose `up`, Caddy reload, `pnpm bootstrap`, migrate, restart `adili-apps`
3. curl the HTTPS portal, console and Keycloak issuer until they return 200

It does **not** re-seed, re-issue certificates, or `terraform apply`. The SSH host key is pinned in `infra/azure/known_hosts`.

Portal, console and verify send a content security policy (including `frame-ancestors 'none'`), `X-Frame-Options: DENY`, and HSTS when the request is https. Check the hosted demo:

```sh
./infra/azure/check-security-headers.sh https://adili-demo.southafricanorth.cloudapp.azure.com
```

Repo secret (Actions -> Secrets):

| Name | Value |
|---|---|
| `AZURE_DEMO_SSH_KEY` | Private ed25519 key whose public half is in `~adili/.ssh/authorized_keys` on the VM |

`adili` may passwordless-sudo only `/usr/local/sbin/adili-demo-root` (root-owned, not in the rsync tree). PRs that touch `infra/azure` also `terraform fmt` / `validate` (no Azure credentials).

## Keycloak specifics that must stay

- Image built from `infra/docker/keycloak.Dockerfile` (theme + `adili-otp` extension)
- Realm file `infra/compose/keycloak/adili-realm.json`
- File vault at `/opt/keycloak/vault` (`adili_keycloak-extension-secret`)
- `start-dev --import-realm` for the demo (same as local)
- Staff TOTP and declarant/applicant SMS OTP unchanged

The committed `vault-dev` secrets are for local and this demo only (ADR-012). Do not use them for a real EACC deployment.

## Tear down

```sh
terraform destroy
```
