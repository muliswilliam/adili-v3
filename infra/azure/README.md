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
2. `/opt/adili/infra/azure/deploy.sh` as `adili` - Compose `up`, Caddy reload, `pnpm bootstrap`, migrate, restart `adili-apps`, install the nightly backup cron
3. curl the HTTPS portal, console and Keycloak issuer until they return 200

It does **not** re-seed, re-issue certificates, or `terraform apply`. The SSH host key is pinned in `infra/azure/known_hosts`.

## Backups

Dumps live in `/home/adili/adili-backups/<utc-stamp>/` (override with `ADILI_BACKUP_ROOT`). That path is outside `/opt/adili`, so the deploy rsync cannot delete them. Each directory has one custom-format dump per demo database plus `SHA256SUMS`, readable only by the user who ran the backup. `adili_test` is not included. Retention removes stamp directories older than 7 days and leaves anything else under the backup root alone.

```sh
./infra/azure/backup-databases.sh
./infra/azure/verify-restore.sh          # restores each dump into a throwaway database, then drops it
```

A real replace of the live databases stops the apps first:

```sh
sudo systemctl stop adili-apps
ADILI_RESTORE_CONFIRM=yes ./infra/azure/restore-databases.sh /home/adili/adili-backups/<stamp>
sudo systemctl start adili-apps
```

`deploy.sh` and `bootstrap-stack.sh` install this into `adili`'s crontab, so a VM rebuild gets the schedule again on the next deploy. Output, including a failed backup or restore check, is appended to `/home/adili/adili-backup.log`:

```cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 2 * * * /opt/adili/infra/azure/backup-databases.sh >>/home/adili/adili-backup.log 2>&1 && /opt/adili/infra/azure/verify-restore.sh >>/home/adili/adili-backup.log 2>&1
```

Repo secret (Actions -> Secrets):

| Name | Value |
|---|---|
| `AZURE_DEMO_SSH_KEY` | Private ed25519 key whose public half is in `~adili/.ssh/authorized_keys` on the VM |

`adili` may passwordless-sudo only `/usr/local/sbin/adili-demo-root` (root-owned, not in the rsync tree). PRs that touch `infra/azure` also `terraform fmt` / `validate` (no Azure credentials).

## Keycloak specifics that must stay

- Image built from `infra/docker/keycloak.Dockerfile` (theme + `adili-otp` extension)
- Realm file `infra/compose/keycloak/adili-realm.json`
- File vault at `/opt/keycloak/vault`, mounted from `/home/adili/.config/adili/keycloak-vault` (outside the rsync tree, mode 700/600, owned by adili, Keycloak's uid). `deploy.sh` creates it once (`demo-vault.sh`): the repo's development entries, plus a **random demo ticket secret per host** (#616), since that secret signs demo accounts in with no password or code. `configure-app-env.sh` copies it into the portal and console `.env` (mode 600) from the file; it is never printed. To rotate: delete `adili_demo-ticket-secret` there and redeploy.
- `start-dev --import-realm` for the demo (same as local)
- Staff TOTP and declarant/applicant SMS OTP unchanged

The committed `vault-dev` secrets are for local and this demo only (ADR-012), except the demo ticket secret, which the demo host replaces with its own. Do not use them for a real EACC deployment.

## OpenBao state

OpenBao holds the per-tenant transit keys that seal declaration fields, the document signing keys and the demo root CA. It runs as a persistent server: integrated storage on the `openbao-data` volume (`/openbao/file` in the container), unsealed on start by the static seal key committed in `infra/compose/openbao/server/demo-seal.key`. That key is demo-only (ADR-012); a real deployment uses an HSM or KMS seal.

- Restarts, reboots and redeploys keep every key, so sealed data stays readable.
- A demo checkpoint must capture `openbao-data` together with the Postgres databases: stop `openbao`, archive the volume, start it again. Restoring one without the other leaves ciphertext that no key opens.
- Deleting the volume (`pnpm infra:reset`, `docker compose down -v`) deletes the keys: drop and re-seed the demo databases too.

One-time switch on a stack that ran the old dev-mode OpenBao (in memory): its keys are already gone after any restart, so data sealed under them cannot be recovered. After the deploy recreates `openbao` and `openbao-init` initialises it, reset the demo data (drop and migrate the service databases, then seed again).

## Tear down

```sh
terraform destroy
```
