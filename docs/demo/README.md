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

Locally and in tests the mocks stay on (`.env.example`); a local stack runs the real backend once you set its `*_MOCK=false`.

Check a running stack:

```sh
pnpm health        # readiness, each app's mocks and the AI provider
pnpm demo:check    # the same, failing unless every mock is off and the AI provider is real
```

### The API key

The key never goes in the repo, in a `.env.example` or in a log. On the VM it is read from the first of:

1. `/etc/adili/secrets.env`, owned by root, readable by `adili` (`root:adili`, mode 0640)
2. `/home/adili/.config/adili/secrets.env` (mode 0600), written by every deploy when the repo secret `ANTHROPIC_API_KEY` is set

Each holds one line, `ANTHROPIC_API_KEY=...`. With no key the ai-gateway stays on replay and the deploy warns.

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
