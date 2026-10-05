# Demo

How to run the hackathon demo (#371): accounts, where it runs, the story, and what to do when something fails.

## Accounts

Every demo login and its purpose: [demo accounts](../demo-accounts.md). One-click switching between them is #616.

## Hosted URLs

| App | URL |
|---|---|
| Portal (declarants, applicants, public open data) | https://adili-demo.southafricanorth.cloudapp.azure.com |
| Console (Commission and EACC staff) | https://adili-demo.southafricanorth.cloudapp.azure.com:3020 |
| Verify (QR codes on issued documents) | https://adili-demo.southafricanorth.cloudapp.azure.com:3030 |
| Keycloak | https://adili-demo.southafricanorth.cloudapp.azure.com:8080 |

The host and its deploys: [infra/azure](../../infra/azure/README.md).

## Story

See #622.

## Checkpoints

See #621.

## Real backend and AI provider

The hosted demo runs the real services and the real AI provider. Every deploy enforces it (`infra/azure/configure-app-env.sh`), whatever the VM's `.env` files held before:

- portal, console and verify: every development mock off (each `*_MOCK` setting the app declares)
- ai-gateway: Anthropic, with the key from the VM's secrets file
- services: reminders at midday sharp (`REMINDER_JITTER_HOURS=0`); the demo Commissions (`psc`, `tsc`, `eacc`, `jsc`, `npsc`) marked as synthetic data, so the copilot may use the external provider; onboarding and registry rate limits lifted so `pnpm demo:seed` can onboard and check every officer from the host's one IP
- Keycloak: demo sign-in on (`ADILI_DEMO_MODE=true` in `docker-compose.azure.yml`, applied to the existing realm by `scripts/keycloak-demo-sign-in.mjs` on every deploy)
- services: tokens checked against the public issuer (`OIDC_ISSUER_URL`, what Keycloak stamps into tokens), with keys and service tokens fetched from Keycloak on loopback (`OIDC_INTERNAL_URL=http://127.0.0.1:18080/realms/adili`): Caddy holds `:8080` with TLS
- demo windows: review and access in demo mode (`DEMO_MODE=true`); review's short windows come from the seed at run time (`PUT /v1/demo/windows`); access grant documents for `jsc` expire after two minutes (`DEMO_PACKAGE_VALIDITY=PT2M`, `DEMO_WINDOW_TENANTS=jsc`) so verify can show an expired one
- `pnpm demo:seed`: `packages/demo-seed/.env` (mode 600) with the public Keycloak, the portal's public callback and this host's demo ticket secret; its admin calls go to Keycloak on loopback (`KEYCLOAK_ADMIN_URL`) with the host's admin password, since the public URL serves sign-in only

Locally and in tests the mocks stay on (`.env.example`); a local stack runs the real backend once you set its `*_MOCK=false`.

Check a running stack:

```sh
pnpm health        # readiness, each app's mocks and the AI provider
pnpm demo:check    # the same, failing unless every mock is off and the AI provider is real
```

### The provider credentials

The ai-gateway reaches Claude either through the Anthropic API or through a self-hosted LLM Gateway (the open-source [llmgateway](https://github.com/theopenco/llmgateway)), which exposes the same Messages API at `<gateway>/v1/messages`. A gateway we run ourselves keeps the provider credentials and the request log on our own host, a step towards the self-hosted model path in [ADR-007](../adr/0007-vendor-agnostic-ai-layer.md); the gateway still forwards prompts to its upstream provider.

Credentials never go in the repo, in a `.env.example` or in a log. On the VM they are read from the first of:

1. `/etc/adili/secrets.env`, owned by root, readable by `adili` (`root:adili`, mode 0640)
2. `/home/adili/.config/adili/secrets.env` (mode 0600), written by every deploy from the repo secrets and variables below

| Setting | Anthropic API | Self-hosted LLM Gateway |
|---|---|---|
| `ANTHROPIC_API_KEY` (secret) | the key | not set |
| `ANTHROPIC_AUTH_TOKEN` (secret) | not set | the gateway's API key, sent as `Authorization: Bearer` |
| `ANTHROPIC_BASE_URL` (variable) | not set | the gateway's URL without `/v1`, e.g. `https://<your-gateway-host>` |
| `ANTHROPIC_STRUCTURED_OUTPUT` (variable) | not set (`native`) | `prompted`: the gateway drops `output_config.format`, so the schema goes in the system prompt |
| `AI_MODEL` (variable) | not set (`claude-opus-5-5`) | optional; `anthropic/claude-opus-5-5` pins the gateway to the Anthropic provider |

For the gateway, from a checkout with `gh` signed in:

```sh
gh secret set ANTHROPIC_AUTH_TOKEN               # paste the gateway API key at the prompt
gh variable set ANTHROPIC_BASE_URL --body 'https://<your-gateway-host>'
gh variable set ANTHROPIC_STRUCTURED_OUTPUT --body prompted
gh variable set AI_MODEL --body anthropic/claude-opus-5-5   # optional
gh workflow run 'Azure demo'                     # deploy now instead of on the next merge
```

The VM must reach the gateway's URL over HTTPS. With neither a key nor a token the ai-gateway stays on replay and the deploy warns. A deploy rewrites the provider settings to exactly what the secrets file holds, so switching between the API and the gateway leaves no stale token behind.

### Switching the AI provider

One command, locally or on the VM (`/opt/adili`):

```sh
pnpm demo:ai replay      # answer from the recorded demo fixtures only: no provider needed
pnpm demo:ai anthropic   # back to the real provider (the hosted default)
pnpm demo:ai record      # the real provider, recording every answer into the fixtures
```

It restarts a running ai-gateway and confirms the switch from its health check. The choice survives deploys. On the hosted VM without SSH, run the **Azure demo command** workflow (Actions, `ai` with `replay` or `anthropic`).

Replay answers from `services/ai-gateway/fixtures/demo/` ([how they are recorded](../../services/ai-gateway/fixtures/demo/README.md)). Requests match with ids and timestamps ignored, so a beat recorded once replays on every later run from the same checkpoint.

## Fallbacks

- AI provider down or slow: `pnpm demo:ai replay`.
- More: see #622.

## Demo-day checklist

See #622.
