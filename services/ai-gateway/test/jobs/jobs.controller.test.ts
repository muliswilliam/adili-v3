import { EventEmitter } from 'node:events';

import type { Principal } from '@adili/api-kit';
import type { FastifyReply } from 'fastify';
import { describe, expect, it } from 'vitest';

import { JobsController } from '../../src/jobs/jobs.controller.js';
import type { JobsService } from '../../src/jobs/jobs.service.js';
import type { AnswerStreams, StreamFrame } from '../../src/jobs/answer-streams.js';

/** The response of a caller that left while the stream was opening: its socket already closed. */
function closedResponse() {
  const raw = Object.assign(new EventEmitter(), {
    destroyed: true,
    writableEnded: false,
    writeHead: () => raw,
    flushHeaders: () => undefined,
    write: () => true,
    end: () => undefined,
  });
  return { hijack: () => undefined, raw } as unknown as FastifyReply;
}

describe('JobsController stream', () => {
  it('ends the stream of a caller that left before it opened', async () => {
    let signal: AbortSignal | undefined;
    const streams = {
      open: () =>
        Promise.resolve({
          // eslint-disable-next-line @typescript-eslint/require-await -- no provider to wait for
          async *frames(caller: AbortSignal): AsyncGenerator<StreamFrame> {
            signal = caller;
            if (!caller.aborted) yield { event: 'error', data: { reason: 'provider' } };
          },
        }),
    } as unknown as AnswerStreams;
    const controller = new JobsController({} as JobsService, streams);
    const reply = closedResponse();

    await controller.streamAnswer(
      {},
      '0192f1a0-5a11-7000-8000-00000000c001',
      'demo',
      {} as Principal,
      reply,
    );

    expect(signal?.aborted).toBe(true);
  });
});
