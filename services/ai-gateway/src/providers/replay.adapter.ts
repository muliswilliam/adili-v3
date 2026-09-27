import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { hashJson } from '../hashing.js';
import type {
  BatchItem,
  BatchItemOutcome,
  BatchStatus,
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  ProviderCapabilities,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
} from './port.js';

type Operation = 'generate' | 'generateStructured' | 'stream';

interface Fixture<TResponse> {
  version: 1;
  operation: Operation;
  request: GenerateRequest;
  response: TResponse;
}

/** Identifies a recorded response: SHA-256 over the operation and the canonical neutral request. */
export function requestHash(operation: Operation, request: GenerateRequest): string {
  return hashJson({ operation, request });
}

export class ReplayFixtureMissingError extends Error {
  override readonly name = 'ReplayFixtureMissingError';

  constructor(
    readonly operation: Operation,
    readonly hash: string,
    readonly path: string,
  ) {
    super(
      `No recorded ${operation} response for request ${hash} (expected ${path}). ` +
        'Refresh fixtures by running with AI_REPLAY_MODE=record and a provider key.',
    );
  }
}

export interface ReplayAdapterOptions {
  fixturesDir: string;
  /** `replay` serves fixtures only; `record` calls `inner` and writes what it returns. */
  mode: 'replay' | 'record';
  inner?: ModelProvider;
}

const ALL_CAPABILITIES: ProviderCapabilities = {
  structuredOutput: true,
  streaming: true,
  batch: true,
  promptCaching: true,
  attachments: ['image', 'pdf', 'text'],
};

/**
 * Serves recorded provider responses keyed by request hash, so tests, evals and the demo run
 * deterministically without a provider. Record mode refreshes the fixtures from a real provider;
 * fixture diffs are reviewed like code. Fixtures hold the full request (system prompt, messages,
 * attachments) and are committed, so record only synthetic inputs, never real declarations.
 */
export class ReplayAdapter implements ModelProvider {
  readonly name = 'replay';
  readonly capabilities: ProviderCapabilities;
  private readonly inner: ModelProvider | undefined;
  /** Replayed batches never leave the process; their items are resolved from fixtures on poll. */
  private readonly replayBatches = new Map<string, BatchItem[]>();

  constructor(private readonly options: ReplayAdapterOptions) {
    if (options.mode === 'record' && !options.inner) {
      throw new Error('ReplayAdapter in record mode needs an inner provider to record from');
    }
    this.inner = options.mode === 'record' ? options.inner : undefined;
    this.capabilities = this.inner?.capabilities ?? ALL_CAPABILITIES;
  }

  generate(request: GenerateRequest): Promise<GenerateResult> {
    return this.serve('generate', request, (inner) => inner.generate(request));
  }

  generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    return this.serve('generateStructured', request, (inner) => inner.generateStructured(request));
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    if (!this.inner) {
      yield* await this.read<StreamEvent[]>('stream', request);
      return;
    }
    const iterator = this.inner.stream(request)[Symbol.asyncIterator]();
    const events: StreamEvent[] = [];
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      events.push(next.value);
      let resumed = false;
      try {
        yield next.value;
        resumed = true;
      } finally {
        if (!resumed) {
          // The consumer stopped early; finish reading so the fixture holds the whole stream.
          await this.recordRest(request, iterator, events);
        }
      }
    }
    await this.write('stream', request, events);
  }

  async submitBatch(items: BatchItem[]): Promise<{ batchId: string }> {
    if (this.inner) {
      const { batchId } = await this.inner.submitBatch(items);
      // On disk, not in memory: a batch can take a day, and outlive this process.
      await this.writeFile(this.pendingBatchPath(batchId), items);
      return { batchId };
    }
    // Fail at submission, like a provider rejecting a bad batch, rather than on a later poll.
    await Promise.all(items.map((item) => this.read('generateStructured', item.request)));
    const batchId = `replay-${hashJson(items).slice(0, 24)}`;
    this.replayBatches.set(batchId, items);
    return { batchId };
  }

  async pollBatch(batchId: string): Promise<BatchStatus> {
    if (this.inner) {
      const status = await this.inner.pollBatch(batchId);
      if (status.status === 'ended') {
        const items = await this.readPendingBatch(batchId);
        const byId = new Map(items.map((item) => [item.customId, item.request]));
        await Promise.all(
          status.outcomes.map(async (outcome) => {
            const request = byId.get(outcome.customId);
            // Errors are transient; only results become fixtures.
            if (request && 'result' in outcome) {
              await this.write('generateStructured', request, outcome.result);
            }
          }),
        );
        await rm(this.pendingBatchPath(batchId), { force: true });
      }
      return status;
    }
    const items = this.replayBatches.get(batchId);
    if (!items) {
      throw new Error(`Unknown replay batch ${batchId}`);
    }
    const outcomes = await Promise.all(
      items.map(async (item): Promise<BatchItemOutcome> => ({
        customId: item.customId,
        result: await this.read<StructuredResult>('generateStructured', item.request),
      })),
    );
    return { batchId, status: 'ended', outcomes };
  }

  private async serve<TResponse>(
    operation: Operation,
    request: GenerateRequest,
    call: (inner: ModelProvider) => Promise<TResponse>,
  ): Promise<TResponse> {
    if (!this.inner) {
      return this.read<TResponse>(operation, request);
    }
    const response = await call(this.inner);
    await this.write(operation, request, response);
    return response;
  }

  private path(hash: string): string {
    return join(this.options.fixturesDir, `${hash}.json`);
  }

  /** Items of a recorded batch still in flight, to key each outcome's fixture by its request. */
  private pendingBatchPath(batchId: string): string {
    return join(this.options.fixturesDir, `${encodeURIComponent(batchId)}.pending-batch.json`);
  }

  private async readPendingBatch(batchId: string): Promise<BatchItem[]> {
    const path = this.pendingBatchPath(batchId);
    try {
      return JSON.parse(await readFile(path, 'utf8')) as BatchItem[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Cannot record batch ${batchId}: it was not submitted in record mode with these ` +
            `fixtures (expected ${path})`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async recordRest(
    request: GenerateRequest,
    iterator: AsyncIterator<StreamEvent>,
    events: StreamEvent[],
  ): Promise<void> {
    try {
      for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
        events.push(next.value);
      }
    } catch {
      // The stream failed after the consumer left; there is no complete response to record.
      return;
    }
    await this.write('stream', request, events);
  }

  private async read<TResponse>(
    operation: Operation,
    request: GenerateRequest,
  ): Promise<TResponse> {
    const hash = requestHash(operation, request);
    const path = this.path(hash);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ReplayFixtureMissingError(operation, hash, path);
      }
      throw error;
    }
    return (JSON.parse(raw) as Fixture<TResponse>).response;
  }

  private async write(
    operation: Operation,
    request: GenerateRequest,
    response: unknown,
  ): Promise<void> {
    const fixture: Fixture<unknown> = { version: 1, operation, request, response };
    await this.writeFile(this.path(requestHash(operation, request)), fixture);
  }

  private async writeFile(path: string, content: unknown): Promise<void> {
    await mkdir(this.options.fixturesDir, { recursive: true });
    await writeFile(path, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  }
}
