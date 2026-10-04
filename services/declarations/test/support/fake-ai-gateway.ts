import { randomUUID } from 'node:crypto';

import {
  type AiJobReason,
  AiGatewayClient,
  AiGatewayUnavailable,
  type AnswerFrame,
  type AnswerInput,
  type AnswerOutput,
  type AnswerRequest,
  type FeedbackInput,
  type HintsJob,
  type HintsRequest,
} from '../../src/ai-gateway/ai-gateway-client.js';

/** What the fake answers a request with: the frames' prose and the job's output, or a failure. */
export type ScriptedAnswer =
  | { kind: 'answer'; output: AnswerOutput; deltas?: string[] }
  | { kind: 'error'; reason: AiJobReason; deltas?: string[] }
  | { kind: 'unavailable' };

/** What the fake answers a hints job with. */
export type ScriptedHints =
  | { kind: 'succeeded'; output: AnswerOutput }
  | { kind: 'running' }
  | { kind: 'failed' }
  | { kind: 'unavailable' };

/** By default: one hint per residual, naming its rule and path, linked to it. */
export function writingHints(input: AnswerInput): AnswerOutput {
  return {
    label: answerLabel(),
    declined: false,
    blocks: input.context.residuals.map((residual) => ({
      text: `${input.language === 'sw' ? 'Kidokezo' : 'Hint'}: ${residual.ruleId} at ${residual.fieldPath}`,
      passageIds: [],
      sectionLink: { sectionKey: residual.sectionKey, fieldPath: residual.fieldPath },
    })),
    followUps: [],
  };
}

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
 * The ai-gateway's answer stream, hints jobs and feedback, in memory: records each request (the
 * input the gateway would see) and answers it with the script set for it, by default an answer
 * citing the first passage and one hint per residual. A rating is recorded for a job it ran.
 */
export class FakeAiGateway extends AiGatewayClient {
  readonly requests: { request: AnswerRequest; idempotencyKey: string }[] = [];
  readonly hintRequests: { request: HintsRequest; idempotencyKey: string }[] = [];
  readonly feedback: { tenant: string; jobId: string; feedback: FeedbackInput }[] = [];
  /** The jobs it ran (answers that ended, hints), by id: what it knows to rate. */
  private readonly jobs = new Set<string>();
  private script: (input: AnswerInput) => ScriptedAnswer = (input) => ({
    kind: 'answer',
    output: citingFirstPassage(input),
  });
  private hintsScript: (input: AnswerInput) => ScriptedHints = (input) => ({
    kind: 'succeeded',
    output: writingHints(input),
  });
  private feedbackDown = false;
  private heldFeedback: Promise<void> | null = null;

  /** Answers every following request with `script`. */
  answer(script: (input: AnswerInput) => ScriptedAnswer): void {
    this.script = script;
  }

  /** The inputs the gateway received, in order. */
  inputs(): AnswerInput[] {
    return this.requests.map(({ request }) => request.input);
  }

  /** Answers every following hints job with `script`. */
  hints(script: (input: AnswerInput) => ScriptedHints): void {
    this.hintsScript = script;
  }

  /** Makes every following rating fail as unreachable (`true`), or be recorded again. */
  feedbackUnavailable(down = true): void {
    this.feedbackDown = down;
  }

  /**
   * Holds the next rating's answer (it is recorded at once) until the returned function is
   * called: a rating still on its way while another lands.
   */
  holdFeedback(): () => void {
    let release = (): void => undefined;
    this.heldFeedback = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  }

  /** Forgets every job it ran, as a gateway that no longer knows them. */
  forgetJobs(): void {
    this.jobs.clear();
  }

  reset(): void {
    this.requests.length = 0;
    this.hintRequests.length = 0;
    this.feedback.length = 0;
    this.jobs.clear();
    this.feedbackDown = false;
    this.heldFeedback = null;
    this.answer((input) => ({ kind: 'answer', output: citingFirstPassage(input) }));
    this.hints((input) => ({ kind: 'succeeded', output: writingHints(input) }));
  }

  runHints(request: HintsRequest, idempotencyKey: string): Promise<HintsJob> {
    this.hintRequests.push({ request: structuredClone(request), idempotencyKey });
    const scripted = this.hintsScript(request.input);
    if (scripted.kind === 'unavailable') {
      return Promise.reject(new AiGatewayUnavailable('The ai-gateway service answered 429'));
    }
    const id = randomUUID();
    this.jobs.add(id);
    if (scripted.kind === 'succeeded') {
      return Promise.resolve({ id, status: 'succeeded', output: scripted.output });
    }
    return Promise.resolve({ id, status: scripted.kind, output: null });
  }

  async recordFeedback(tenant: string, jobId: string, feedback: FeedbackInput): Promise<boolean> {
    if (this.feedbackDown) {
      throw new AiGatewayUnavailable('The ai-gateway service did not answer');
    }
    if (!this.jobs.has(jobId)) return false;
    this.feedback.push({ tenant, jobId, feedback: structuredClone(feedback) });
    const held = this.heldFeedback;
    this.heldFeedback = null;
    if (held) await held;
    return true;
  }

  streamAnswer(
    request: AnswerRequest,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<AnswerFrame>> {
    this.requests.push({ request: structuredClone(request), idempotencyKey });
    const scripted = this.script(request.input);
    if (scripted.kind === 'unavailable') {
      return Promise.reject(new AiGatewayUnavailable('The ai-gateway service answered 503'));
    }
    const each = frames(scripted, signal, (id) => this.jobs.add(id));
    return Promise.resolve(
      (async function* () {
        // A stream arrives in turns, as over the network.
        for (const frame of each) {
          await Promise.resolve();
          yield frame;
        }
      })(),
    );
  }
}

function* frames(
  scripted: Exclude<ScriptedAnswer, { kind: 'unavailable' }>,
  signal: AbortSignal,
  ran: (jobId: string) => void,
): Iterable<AnswerFrame> {
  const deltas =
    scripted.deltas ??
    (scripted.kind === 'answer' ? scripted.output.blocks.map((block) => block.text) : []);
  for (const text of deltas) {
    if (signal.aborted) return;
    yield { event: 'delta', text };
  }
  if (signal.aborted) return;
  if (scripted.kind === 'error') {
    yield { event: 'error', reason: scripted.reason };
    return;
  }
  const id = randomUUID();
  ran(id);
  yield { event: 'final', job: { id, output: scripted.output } };
}
