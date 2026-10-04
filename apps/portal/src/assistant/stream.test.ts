import { describe, expect, it } from 'vitest';

import { readAnswerStream } from './stream';

function body(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function frames(stream: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const frame of readAnswerStream(stream)) out.push(frame);
  return out;
}

describe('reading the answer stream', () => {
  it('yields deltas then the final answer, across chunk boundaries and CRLF, skipping pings', async () => {
    const final = { question: { id: 'q' }, answer: { id: 'a' } };
    expect(
      await frames(
        body(
          ': ping\n\nevent: delta\ndata: {"text":"Yes. "}\n\nevent: del',
          'ta\r\ndata: {"text":"Declare it."}\r\n\r\n',
          `event: final\ndata: ${JSON.stringify(final)}\n\n`,
        ),
      ),
    ).toEqual([
      { event: 'delta', text: 'Yes. ' },
      { event: 'delta', text: 'Declare it.' },
      { event: 'final', question: final.question, answer: final.answer },
    ]);
  });

  it('yields an error frame with its code', async () => {
    expect(await frames(body('event: error\ndata: {"code":"assistant-unavailable"}\n\n'))).toEqual([
      { event: 'error', code: 'assistant-unavailable' },
    ]);
  });

  it('ends a stream that stops without a final or error frame with an error', async () => {
    expect(await frames(body('event: delta\ndata: {"text":"Yes."}\n\n'))).toEqual([
      { event: 'delta', text: 'Yes.' },
      { event: 'error', code: 'stream-ended' },
    ]);
  });

  it('reads a frame it cannot parse as the end of the stream', async () => {
    expect(await frames(body('event: delta\ndata: {not json\n\n'))).toEqual([
      { event: 'error', code: 'stream-ended' },
    ]);
  });
});
