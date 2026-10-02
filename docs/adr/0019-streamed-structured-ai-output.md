# ADR-019: Streamed structured AI output as tagged text

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Adili V3 DIALs team
- **Extends:** [ADR-007](0007-vendor-agnostic-ai-layer.md) (the provider port and the gateway's controls). Nothing in ADR-007 changes.
- **Related:** [ADR-008](0008-audit-trail.md), spec 11 (#296, #332)

## Context

Ask Adili's answers stream to the declarant as the model writes them (spec 11), but every answer must also arrive as structure the platform checks: blocks, each citing the passages it rests on, an optional link to a field, follow-up questions, or a decline. An answer whose blocks cite what retrieval did not return is replaced by the decline (S3).

ADR-007's port streams text only: `stream(req)` yields text deltas, then one final result. Structured output (`generateStructured`) returns a whole JSON object at the end. Every provider we may route to supports plain text streaming, including the self-hosted model ADR-007 plans for; structured output while streaming is a vendor feature, where it exists at all.

## Decision

1. **The port stays as it is.** No structured-streaming operation is added to `ModelProvider`.
2. **A task that needs structure while streaming has the model write tagged text.** For `answer-declarant-question`:

   ```
   <block>Plain-language paragraph. <cite ids="id1,id2"/> <link section="…" field="…"/></block>
   <followup>A question the declarant may ask next?</followup>
   ```

   or `<declined/>` alone. Each block has one `<cite>` (one or more passage ids) and at most one `<link>`. Tags look nothing like minimisation tokens (`[[PERSON_1]]`), which the reader holds back across chunk boundaries until they are whole and can be restored.
3. **The gateway reads it** (`TaggedAnswerReader`): it streams only the blocks' prose as SSE `delta` events, then reads the whole text into the task's output, which is checked as a job's output is (schema, identifiers restored, the task's own checks).
4. **A failed check declines; it does not fail.** Text that breaks the grammar, a cut-off answer, or blocks citing passages the input does not hold become `declined: true` with no blocks. The job succeeds, and the violations (kinds and block indexes, never text) are kept on the job and its audit record. The caller shows its decline, with the reporting officer's contact, rather than "AI unavailable". Deltas are provisional until the `final` frame. Such a decline does not serve the cache: the failure is the model's, not the input's, so an equal request calls the provider again, as it would after a job failed with reason `validation`.
5. **A streamed job runs in the request**, not in a Temporal workflow: same idempotency key, cache, rate limit, classification gate, budget, breaker, minimisation, audit and events as any job. A caller that disconnects ends it as failed with reason `provider`, the contract's reason for a call that ended without a result (adding `cancelled` would change every consumer's exhaustive `JobReason` copy). It retries a transient provider failure only before anything has streamed, and must end within the janitor's grace window, after which the janitor fails it as abandoned (its process died).
6. **Which inputs stream is the task's choice** (`TaskSpec.streamed`): `answer` mode streams, `hints` mode runs as an ordinary structured job. Each endpoint refuses the other's inputs.

## Alternatives considered

| Option | Why not |
|---|---|
| Stream structured JSON and pull `text` out of partial JSON | Needs structured output while streaming in the port: a vendor feature the self-hosted target may lack, so the migration ADR-007 promises would stop being a config change. |
| Stream prose, then a second structured call for the citations | Twice the cost and latency, and two outputs that can disagree with what the declarant already read. |
| No streaming: a job with `waitSeconds` | An answer takes seconds to write; the declarant would watch a spinner, which spec 11 rules out. |
| Fail the job on a bad citation | The declarant would see "AI unavailable", which is wrong: the honest answer is that the corpus does not support one. |

## Consequences

**Positive**
- Any provider that streams text can serve the task; the self-hosted switch stays a routing change, measured by the same evals.
- The grammar is checked by deterministic code, testable without a model; chunk boundaries are tested against recorded streams.

**Negative / risks**
- The model can break the grammar. Mitigated by the prompt, the decline rule, and the `well-formed` eval scorer, which measures how often it happens.
- Prose can stream before the final checks decline it. The portal replaces the bubble on `final`; the prompt asks for `<declined/>` first and alone, so a true non-answer streams nothing.
