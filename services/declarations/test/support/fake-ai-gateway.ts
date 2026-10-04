import { randomUUID } from 'node:crypto';

import {
  type AiJobReason,
  AiGatewayClient,
  AiGatewayUnavailable,
  type AnswerFrame,
  type AnswerInput,
  type AnswerOutput,
  type AnswerRequest,
} from '../../src/ai-gateway/ai-gateway-client.js';

/** What the fake answers a request with: the frames' prose and the job's output, or a failure. */
export type ScriptedAnswer =
  | { kind: 'answer'; output: AnswerOutput; deltas?: string[] }
  | { kind: 'error'; reason: AiJobReason; deltas?: string[] }
  /**
   * The deltas, then nothing until the request is aborted (the declarant left), then the final
   * all the same, as one already on its way would arrive.
   */
  | { kind: 'held'; output: AnswerOutput; deltas: string[] }
  | { kind: 'unavailable' };

/** An answer label as the gateway gives it. */
export function answerLabel(): AnswerOutput['label'] {
  return {
    aiAssisted: true,
    task: 'answer-declarant-question',
    promptVersion: 1,
    provider: 'replay',
    model: 'replay-1',
    generatedAt: '2027-11-15T09:00:00.000Z',
    disclaimer: 'AI-assisted guidance from the Act and Regulations, not legal advice.',
  };
}

/** By default: one block citing the first passage the request retrieved, in its language. */
export function citingFirstPassage(input: AnswerInput): AnswerOutput {
  const first = input.passages[0];
  if (!first) return { label: answerLabel(), declined: true, blocks: [], followUps: [] };
  return {
    label: answerLabel(),
    declined: false,
    blocks: [
      {
        text:
          input.language === 'sw'
            ? `Ndiyo, tangaza gari hilo kama mali (${first.citation}).`
            : `Yes, declare the vehicle as an asset (${first.citation}).`,
        passageIds: [first.id],
        sectionLink: null,
      },
    ],
    followUps: [],
  };
}

/**
 * The ai-gateway's answer stream, in memory: records each request (the input the gateway would
 * see) and answers it with the script set for it, by default an answer citing the first passage.
 */
export class FakeAiGateway extends AiGatewayClient {
  /**
   * Each request: what was sent, the signal it was sent with (aborted when the service cancels
   * the job) and whether the service has closed the stream it got.
   */
  readonly requests: {
    request: AnswerRequest;
    idempotencyKey: string;
    signal: AbortSignal;
    closed: boolean;
  }[] = [];
  private script: (input: AnswerInput) => ScriptedAnswer = (input) => ({
    kind: 'answer',
    output: citingFirstPassage(input),
  });

  /** Answers every following request with `script`. */
  answer(script: (input: AnswerInput) => ScriptedAnswer): void {
    this.script = script;
  }

  /** The inputs the gateway received, in order. */
  inputs(): AnswerInput[] {
    return this.requests.map(({ request }) => request.input);
  }

  reset(): void {
    this.requests.length = 0;
    this.answer((input) => ({ kind: 'answer', output: citingFirstPassage(input) }));
  }

  streamAnswer(
    request: AnswerRequest,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<AnswerFrame>> {
    const sent = { request: structuredClone(request), idempotencyKey, signal, closed: false };
    this.requests.push(sent);
    const scripted = this.script(request.input);
    if (scripted.kind === 'unavailable') {
      return Promise.reject(new AiGatewayUnavailable('The ai-gateway service answered 503'));
    }
    const each = scripted.kind === 'held' ? held(scripted, signal) : arriving(scripted, signal);
    return Promise.resolve(
      (async function* () {
        try {
          yield* each;
        } finally {
          sent.closed = true;
        }
      })(),
    );
  }
}

/** The scripted frames, in turns, as over the network. */
async function* arriving(
  scripted: Extract<ScriptedAnswer, { kind: 'answer' | 'error' }>,
  signal: AbortSignal,
): AsyncIterable<AnswerFrame> {
  for (const frame of frames(scripted, signal)) {
    await Promise.resolve();
    yield frame;
  }
}

async function* held(
  scripted: Extract<ScriptedAnswer, { kind: 'held' }>,
  signal: AbortSignal,
): AsyncIterable<AnswerFrame> {
  for (const text of scripted.deltas) {
    await Promise.resolve();
    yield { event: 'delta', text };
  }
  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else
      signal.addEventListener(
        'abort',
        () => {
          resolve();
        },
        { once: true },
      );
  });
  yield { event: 'final', job: { id: randomUUID(), output: scripted.output } };
}

function* frames(
  scripted: Extract<ScriptedAnswer, { kind: 'answer' | 'error' }>,
  signal: AbortSignal,
): Iterable<AnswerFrame> {
  const deltas =
    scripted.deltas ??
    (scripted.kind === 'answer' ? scripted.output.blocks.map((block) => block.text) : []);
  for (const text of deltas) {
    if (signal.aborted) return;
    yield { event: 'delta', text };
  }
  if (signal.aborted) return;
  yield scripted.kind === 'answer'
    ? { event: 'final', job: { id: randomUUID(), output: scripted.output } }
    : { event: 'error', reason: scripted.reason };
}
