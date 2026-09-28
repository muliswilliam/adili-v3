import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  BatchItem,
  BatchStatus,
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
} from '../../src/providers/port.js';
import {
  ReplayAdapter,
  ReplayFixtureMissingError,
  fixtureKey,
} from '../../src/providers/replay.adapter.js';

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };

const request: GenerateRequest = {
  model: 'claude-opus-5',
  system: 'You summarise synthetic declarations.',
  messages: [{ role: 'user', content: 'Summarise [[PERSON_1]].' }],
  maxOutputTokens: 1000,
};

const structured: StructuredRequest = {
  ...request,
  schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
};

/** Scripted inner provider standing in for a real vendor in record mode. */
class ScriptedProvider implements ModelProvider {
  readonly name = 'scripted';
  readonly providerClass = 'external';
  readonly capabilities = {
    structuredOutput: true,
    streaming: true,
    batch: true,
    promptCaching: true,
    attachments: ['text'] as const,
  };
  calls = 0;
  private batches = new Map<string, BatchItem[]>();

  generate(): Promise<GenerateResult> {
    this.calls++;
    return Promise.resolve({ status: 'completed', text: 'A short summary.', model: 'm-1', usage });
  }

  generateStructured(): Promise<StructuredResult> {
    this.calls++;
    return Promise.resolve({
      status: 'completed',
      output: { summary: 'A short summary.' },
      model: 'm-1',
      usage,
    });
  }

  async *stream(): AsyncIterable<StreamEvent> {
    this.calls++;
    await Promise.resolve();
    yield { type: 'delta', text: 'A short ' };
    yield { type: 'delta', text: 'summary.' };
    yield {
      type: 'final',
      result: { status: 'completed', text: 'A short summary.', model: 'm-1', usage },
    };
  }

  submitBatch(items: BatchItem[]): Promise<{ batchId: string }> {
    this.calls++;
    this.batches.set('inner-batch-1', items);
    return Promise.resolve({ batchId: 'inner-batch-1' });
  }

  pollBatch(batchId: string): Promise<BatchStatus> {
    const items = this.batches.get(batchId) ?? [];
    return Promise.resolve({
      batchId,
      status: 'ended',
      outcomes: items.map((item, index) =>
        index === 0
          ? {
              customId: item.customId,
              result: { status: 'completed', output: { n: index }, model: 'm-1', usage },
            }
          : { customId: item.customId, error: 'unavailable' },
      ),
    });
  }
}

async function collect(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const all: StreamEvent[] = [];
  for await (const event of events) {
    all.push(event);
  }
  return all;
}

describe('fixtureKey', () => {
  it('ignores key order and undefined fields', () => {
    const reordered = {
      maxOutputTokens: 1000,
      messages: [{ content: 'Summarise [[PERSON_1]].', role: 'user' as const }],
      system: 'You summarise synthetic declarations.',
      model: 'claude-opus-5',
      effort: undefined,
    };
    expect(fixtureKey('generate', reordered)).toBe(fixtureKey('generate', request));
  });

  it('distinguishes operations and content', () => {
    expect(fixtureKey('generate', request)).not.toBe(fixtureKey('stream', request));
    expect(fixtureKey('generate', request)).not.toBe(
      fixtureKey('generate', { ...request, model: 'claude-sonnet-5' }),
    );
  });

  it('is a hex sha-256', () => {
    expect(fixtureKey('generate', request)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('ReplayAdapter', () => {
  let dir: string;
  let inner: ScriptedProvider;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'replay-'));
    inner = new ScriptedProvider();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const recorder = () => new ReplayAdapter({ fixturesDir: dir, mode: 'record', inner });
  const replayer = () => new ReplayAdapter({ fixturesDir: dir, mode: 'replay' });

  it('records a structured response to a fixture named by the request hash', async () => {
    const result = await recorder().generateStructured(structured);

    expect(result).toEqual({
      status: 'completed',
      output: { summary: 'A short summary.' },
      model: 'm-1',
      usage,
    });
    const file = join(dir, `${fixtureKey('generateStructured', structured)}.json`);
    const fixture = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(fixture).toMatchObject({
      operation: 'generateStructured',
      request: structured,
      response: result,
    });
  });

  it('replays recorded responses without calling a provider', async () => {
    const recorded = await recorder().generate(request);
    inner.calls = 0;

    expect(await replayer().generate(request)).toEqual(recorded);
    expect(inner.calls).toBe(0);
  });

  it('fails clearly when no fixture matches the request', async () => {
    const hash = fixtureKey('generateStructured', structured);
    const error = await replayer()
      .generateStructured(structured)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReplayFixtureMissingError);
    expect((error as Error).message).toContain(hash);
    expect((error as Error).message).toContain('record');
  });

  it('does not reuse a fixture recorded for another operation', async () => {
    await recorder().generate(request);

    await expect(collect(replayer().stream(request))).rejects.toBeInstanceOf(
      ReplayFixtureMissingError,
    );
  });

  it('records and replays refusals', async () => {
    inner.generateStructured = () =>
      Promise.resolve({
        status: 'refused',
        refusal: { category: 'cyber', explanation: null },
        model: 'm-1',
        usage,
      });
    await recorder().generateStructured(structured);

    expect(await replayer().generateStructured(structured)).toMatchObject({
      status: 'refused',
      refusal: { category: 'cyber' },
    });
  });

  it('records and replays streams as the same sequence of events', async () => {
    const recorded = await collect(recorder().stream(request));
    const replayed = await collect(replayer().stream(request));

    expect(recorded.map((e) => e.type)).toEqual(['delta', 'delta', 'final']);
    expect(replayed).toEqual(recorded);
  });

  it('records batch outcomes per item and replays them as a batch', async () => {
    const items: BatchItem[] = [
      { customId: 'a', request: structured },
      { customId: 'b', request: { ...structured, model: 'claude-sonnet-5' } },
    ];
    const rec = recorder();
    const { batchId } = await rec.submitBatch(items);
    const recorded = await rec.pollBatch(batchId);

    expect(recorded).toMatchObject({ status: 'ended' });
    // Only results are fixtures; errors are transient and must be re-recorded.
    expect(await readdir(dir)).toEqual([`${fixtureKey('generateStructured', structured)}.json`]);

    const replay = replayer();
    const replayedBatch = await replay.submitBatch(items.slice(0, 1));
    expect(await replay.pollBatch(replayedBatch.batchId)).toEqual({
      batchId: replayedBatch.batchId,
      status: 'ended',
      outcomes: [
        { customId: 'a', result: { status: 'completed', output: { n: 0 }, model: 'm-1', usage } },
      ],
    });
  });

  it('records a batch polled by a later process than the one that submitted it', async () => {
    const items: BatchItem[] = [{ customId: 'a', request: structured }];
    const { batchId } = await recorder().submitBatch(items);

    await recorder().pollBatch(batchId);

    expect(await readdir(dir)).toEqual([`${fixtureKey('generateStructured', structured)}.json`]);
    expect(await replayer().generateStructured(structured)).toMatchObject({ output: { n: 0 } });
  });

  it('refuses to record a batch it has no record of submitting', async () => {
    await expect(recorder().pollBatch('inner-batch-1')).rejects.toThrow(/Cannot record batch/);
  });

  it('records the whole stream when the consumer stops early', async () => {
    for await (const event of recorder().stream(request)) {
      expect(event.type).toBe('delta');
      break;
    }

    expect((await collect(replayer().stream(request))).map((e) => e.type)).toEqual([
      'delta',
      'delta',
      'final',
    ]);
  });

  it('rejects a replayed batch up front when an item has no fixture', async () => {
    await expect(
      replayer().submitBatch([{ customId: 'a', request: structured }]),
    ).rejects.toBeInstanceOf(ReplayFixtureMissingError);
  });

  it('requires an inner provider to record', () => {
    expect(() => new ReplayAdapter({ fixturesDir: dir, mode: 'record' })).toThrow(/inner/);
  });

  it('is named replay and reports full capabilities when replaying', () => {
    expect(replayer().name).toBe('replay');
    expect(replayer().capabilities).toMatchObject({
      structuredOutput: true,
      streaming: true,
      batch: true,
    });
  });
});
