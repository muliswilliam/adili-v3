# ADR-007: Vendor-agnostic AI layer - Anthropic now, self-hosted inference later

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-005](0005-message-queue-rabbitmq.md), [ADR-006](0006-multi-tenancy-and-hierarchy.md), [ADR-008](0008-audit-trail.md)

## Context

AI supports declarants, reviewers and EACC. The target production setup is **self-hosted inference in Kenya**, because declarations are sensitive financial data of officers and their families, and cross-border transfer is restricted (Data Protection Act 2019, ss.48-50; to be confirmed with the EACC DPO). For the hackathon, the team has neither the time nor the hardware to run inference. We use the **Anthropic API** now and must be able to switch to self-hosted models with **minimal migration work**.

**AI supports professional judgement and never replaces it.** Analytics must not be treated as proof of wrongdoing (Agenda, Track 6).

## Decision

### Use cases (AI) vs deterministic checks (code)

| Deterministic code (not AI) | AI tasks |
|---|---|
| Completeness checks | `extractDocument` - read title deeds, logbooks, payslips and bank letters into typed fields to pre-fill the form |
| ±25% value change and acquisition/disposal detection (s.31(4)) | `answerDeclarantQuestion` - guided help on what to declare, in English and Swahili, grounded in the Act and Regulations |
| Income vs asset growth ratios | `summarizeDeclaration` - reviewer summary with links to source fields |
| Cross-checks against KRA, NTSA, BRS, ArdhiSasa, IPRS | `explainFlags` - plain-language explanation of deterministic risk flags |
| Deadline and cycle logic | `draftClarification` - draft a clarification letter (s.35) for a reviewer to edit and approve |
| | `narrateComplianceReport` - narrative sections for Form M and the EACC national report |

Every AI output is labelled as AI-assisted, and **a named human approves** any action based on it.

### Architecture (four layers)

1. **Task layer** (domain-facing):
   - One function per use case, with a typed input and a **Zod output schema**.
   - Prompts are versioned files in the repo (`prompts/<task>/vN.md`).
   - Each task has an **evaluation set** (golden inputs and expected outputs) run in CI.
   - Domain services call tasks, never models.
2. **Provider port** (our interface, no vendor types leak through):
   - `generateStructured<T>(req, schema)`, `generate(req)`, `stream(req)`, `submitBatch(reqs)`
   - Neutral message and attachment types (text, image, PDF)
   - Capability flags: `vision`, `pdfInput`, `structuredOutput`, `promptCaching`, `batch`
3. **Adapters:**
   - **AnthropicAdapter** (now), on the official `@anthropic-ai/sdk`:
     - default model `claude-opus-5`, configurable per task
     - structured outputs; native PDF and image input
     - prompt caching of stable system prompts
     - Message Batches for bulk re-extraction
     - refusal handling with server-side fallback
     - The same adapter can target Claude on Microsoft Foundry through the provider client.
   - **SelfHostedAdapter** (later): an open-weight model served by vLLM in a Kenyan data centre. If the model lacks native PDF input, the adapter reports `pdfInput: false`, and the task layer's pre-processing (page rendering + OCR) supplies images and text instead.
   - **Routing table** (config): task → provider → model → parameters, per environment and per tenant. Switching providers is a config change.
4. **`ai-gateway` service:** the only component with network access to any AI provider. It is responsible for:
   - **Data-classification gate:** a policy for which data classes and tenants may use which provider. The demo tenant allows Anthropic with synthetic data; a production tenant blocks external providers until EACC approves.
   - **Minimisation:** names, ID/KRA numbers and addresses replaced with tokens before sending, restored after.
   - **Prompt-injection defence:** uploaded documents are wrapped as untrusted data, and outputs are validated against schemas before use.
   - **Operations:** per-tenant budgets and rate limits, retries and circuit breaker, results cached by content hash plus prompt version.
   - **Audit of every call** (ADR-008): task, prompt version, provider, model, input hash, token counts, cost, latency, outcome. No raw content in logs.
   - **Telemetry** following the OpenTelemetry GenAI conventions.

### Migration plan to self-hosted

1. Deploy vLLM with the chosen model; implement `SelfHostedAdapter` against the port.
2. Run every task's evaluation set on both providers; adjust prompts per provider where scores differ.
3. Switch the routing table per task once evals pass; keep Anthropic as fallback only where policy allows.
4. No changes in domain services or the task API.

## Alternatives considered

| Option | Why not |
|---|---|
| Call the Anthropic SDK directly from domain services | Vendor lock-in; migration would touch every service. |
| LangChain / LlamaIndex | Heavy abstractions, fast-moving APIs, lags vendor features (caching, batches, citations); hurts code clarity. |
| Vercel AI SDK | Good TypeScript provider abstraction, but lags vendor-specific features and puts the core interface outside our control. A thin port we own is simpler to test and reason about. |
| Self-hosted inference now | Not feasible in the hackathon timeframe or hardware; remains the recommended production target. |

## Consequences

**Positive**
- Moving to sovereign inference is a config change validated by evals, not a rewrite.
- Responsible-AI controls (gate, minimisation, human approval, audit) are built in and can be shown in the demo.
- Strong criterion 5 (emerging tech/AI) story without data-residency exposure: the demo uses synthetic data only.

**Negative / risks**
- **Residency:** using an external provider with real data is likely unlawful without safeguards. Mitigated by the gate and synthetic demo data, and stated openly in the pitch.
- **Quality gap:** open models may score lower on extraction and Swahili. Measured by the eval sets before switching.
- Evaluation sets must be built and maintained per task: it's real work, but it's also what makes model swaps safe.
