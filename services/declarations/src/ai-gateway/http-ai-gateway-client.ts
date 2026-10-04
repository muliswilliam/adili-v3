import { type ServiceTokenClient, ServiceTokenError } from '@adili/api-kit';
import { z } from 'zod';

import {
  AiGatewayClient,
  AiGatewayUnavailable,
  type AiJobReason,
  type AiLabel,
  type AnswerFrame,
  type AnswerJob,
  type AnswerOutput,
  type AnswerRequest,
} from './ai-gateway-client.js';

/** The scope the declarations service's token needs for the gateway's internal API. */
export const AI_SCOPE = 'ai:internal';

/** How long the gateway may take to accept a stream (its checks, before the first byte). */
export const STREAM_OPEN_TIMEOUT_MS = 5_000;

/**
 * The longest a stream may run: the gateway ends its own within 45 s (ADR-019, before its
 * janitor's grace window), so a stream still open past this one is stuck.
 */
export const STREAM_DEADLINE_MS = 55_000;

/** A gap between frames this long, with the gateway's ping every 15 s, means the stream is dead. */
export const STREAM_IDLE_MS = 35_000;

export interface HttpAiGatewayClientOptions {
  gatewayUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests. */
  timeouts?: { openMs?: number; deadlineMs?: number; idleMs?: number };
}

/** ai-gateway.yaml `AiLabel` of this task, as the generated type has it. */
const label = z.object({
  aiAssisted: z.literal(true),
  task: z.literal('answer-declarant-question'),
  promptVersion: z.int(),
  provider: z.string(),
  model: z.string(),
  generatedAt: z.string(),
  disclaimer: z.string(),
}) satisfies z.ZodType<AiLabel>;

const sectionLink = z.object({ sectionKey: z.string(), fieldPath: z.string().nullable() });

const outputSchema = z.object({
  label,
  declined: z.boolean(),
  blocks: z.array(
    z.object({
      text: z.string(),
      passageIds: z.array(z.string()),
      sectionLink: sectionLink.nullable(),
    }),
  ),
  followUps: z.array(z.string()),
}) satisfies z.ZodType<AnswerOutput>;

const finalSchema = z.object({
  job: z.object({ id: z.uuid(), status: z.literal('succeeded'), output: outputSchema }),
});

const REASONS = [
  'policy',
  'budget',
  'validation',
  'refused',
  'provider',
  'provider-unavailable',
  'timeout',
  'cancelled',
] as const satisfies readonly AiJobReason[];

const frameSchemas = {
  delta: z.object({ text: z.string() }),
  final: finalSchema,
  error: z.object({ reason: z.enum(REASONS) }),
};

/**
 * The ai-gateway's answer stream (`POST /internal/v1/tasks/answer-declarant-question/stream`,
 * ai-gateway.yaml) with the service's own token (`ai:internal`, one retry after a 401) and the
 * Commission in `X-Acting-Tenant` (ADR-013 §8.14). Not api-kit's service client: that one reads a
 * JSON body, and this one reads server-sent events as they arrive. The gateway must accept the
 * stream within `STREAM_OPEN_TIMEOUT_MS`; any other status than 200, no token or no answer is
 * `AiGatewayUnavailable`. Frames that break the contract end the stream with an `error` frame.
 */
export class HttpAiGatewayClient extends AiGatewayClient {
  private readonly fetch: typeof fetch;
  private readonly url: string;
  private readonly openMs: number;
  private readonly deadlineMs: number;
  private readonly idleMs: number;

  constructor(private readonly options: HttpAiGatewayClientOptions) {
    super();
    this.fetch = options.fetch ?? globalThis.fetch;
    this.url = `${options.gatewayUrl.replace(/\/+$/, '')}/internal/v1/tasks/answer-declarant-question/stream`;
    this.openMs = options.timeouts?.openMs ?? STREAM_OPEN_TIMEOUT_MS;
    this.deadlineMs = options.timeouts?.deadlineMs ?? STREAM_DEADLINE_MS;
    this.idleMs = options.timeouts?.idleMs ?? STREAM_IDLE_MS;
  }

  async streamAnswer(
    request: AnswerRequest,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<AnswerFrame>> {
    const ended = new AbortController();
    const deadline = setTimeout(() => {
      ended.abort(new Error('The answer stream ran past its deadline'));
    }, this.deadlineMs);
    const stop = () => {
      ended.abort(signal.reason);
    };
    if (signal.aborted) stop();
    signal.addEventListener('abort', stop, { once: true });
    const release = () => {
      clearTimeout(deadline);
      signal.removeEventListener('abort', stop);
    };
    try {
      let response = await this.send(request, idempotencyKey, ended.signal);
      if (response.status === 401) {
        await response.body?.cancel();
        this.options.tokens.invalidate();
        response = await this.send(request, idempotencyKey, ended.signal);
      }
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new AiGatewayUnavailable(
          `The ai-gateway service answered ${String(response.status)}`,
        );
      }
      return readFrames(response.body, { ended, caller: signal, idleMs: this.idleMs, release });
    } catch (error) {
      release();
      ended.abort();
      if (error instanceof AiGatewayUnavailable) throw error;
      throw new AiGatewayUnavailable('The ai-gateway service did not answer', { cause: error });
    }
  }

  private async send(
    request: AnswerRequest,
    idempotencyKey: string,
    ended: AbortSignal,
  ): Promise<Response> {
    let token: string;
    try {
      token = await this.options.tokens.token();
    } catch (error) {
      if (error instanceof ServiceTokenError) {
        throw new AiGatewayUnavailable('No service token for the ai-gateway', { cause: error });
      }
      throw error;
    }
    const { tenant, subjectRef, input } = request;
    // Bounds the wait for the response headers only: the body is bounded by `ended`.
    const opening = new AbortController();
    const timer = setTimeout(() => {
      opening.abort(new Error('The ai-gateway did not accept the stream in time'));
    }, this.openMs);
    try {
      return await this.fetch(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'text/event-stream',
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-acting-tenant': tenant,
        },
        body: JSON.stringify({ dataClass: 'synthetic', subjectRef, input }),
        signal: AbortSignal.any([ended, opening.signal]),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The stream's frames, until a `final` or `error` (the last), the body ends or `ended` aborts.
 * A frame outside the contract, a body cut short or a silence past `idleMs` ends it with an
 * `error` frame (`provider`): the job's fate is then the gateway's to record.
 *
 * Once the caller has left (`caller`), nothing more is yielded.
 */
async function* readFrames(
  body: ReadableStream<Uint8Array>,
  {
    ended,
    caller,
    idleMs,
    release,
  }: { ended: AbortController; caller: AbortSignal; idleMs: number; release: () => void },
): AsyncGenerator<AnswerFrame> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let idle: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      ended.abort(new Error('The answer stream went silent'));
    }, idleMs);
  };
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  ended.signal.addEventListener('abort', cancel, { once: true });
  let buffer = '';
  try {
    touch();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      buffer += value.replaceAll('\r\n', '\n');
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const frame = parseEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\n\n');
        if (frame === undefined) continue;
        yield frame;
        if (frame.event !== 'delta') return;
      }
    }
    // The body ended (or was cut by the deadline or a silence) without a last frame.
    if (!caller.aborted) yield brokenFrame();
  } catch {
    if (!caller.aborted) yield brokenFrame();
  } finally {
    clearTimeout(idle);
    ended.signal.removeEventListener('abort', cancel);
    ended.abort();
    cancel();
    release();
  }
}

/**
 * One event block: its frame, undefined for a comment (`: ping`) or an event of a kind the
 * contract does not have, and an `error` frame for a known kind whose data breaks it.
 */
function parseEvent(block: string): AnswerFrame | undefined {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0 || !(event in frameSchemas)) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(data.join('\n'));
  } catch {
    return { event: 'error', reason: 'provider' };
  }
  if (event === 'delta') {
    const parsed = frameSchemas.delta.safeParse(json);
    return parsed.success ? { event: 'delta', text: parsed.data.text } : brokenFrame();
  }
  if (event === 'final') {
    const parsed = frameSchemas.final.safeParse(json);
    if (!parsed.success) return brokenFrame();
    const job: AnswerJob = { id: parsed.data.job.id, output: parsed.data.job.output };
    return { event: 'final', job };
  }
  const parsed = frameSchemas.error.safeParse(json);
  return parsed.success ? { event: 'error', reason: parsed.data.reason } : brokenFrame();
}

function brokenFrame(): AnswerFrame {
  return { event: 'error', reason: 'provider' };
}
