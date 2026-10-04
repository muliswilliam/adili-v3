import type { AssistantMessage } from '../server/declarations/types';

/**
 * A frame of an Ask Adili answer as the declarations service streams it (`askAssistant`):
 * `delta` adds prose to the answer so far, `final` carries both turns as stored, `error` ends the
 * answer with nothing stored. A stream that stops early or sends what it cannot read ends with
 * the `stream-ended` error.
 */
export type AnswerFrame =
  | { event: 'delta'; text: string }
  | { event: 'final'; question: AssistantMessage; answer: AssistantMessage }
  | { event: 'error'; code: string };

const ENDED: AnswerFrame = { event: 'error', code: 'stream-ended' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One SSE event (its `event` and `data` lines) as a frame; null when it is not one. */
function toFrame(block: string): AnswerFrame | null | 'skip' {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return 'skip';
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join('\n'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (event === 'delta' && typeof parsed.text === 'string') {
    return { event, text: parsed.text };
  }
  if (event === 'final' && isRecord(parsed.question) && isRecord(parsed.answer)) {
    return {
      event,
      question: parsed.question as unknown as AssistantMessage,
      answer: parsed.answer as unknown as AssistantMessage,
    };
  }
  if (event === 'error' && typeof parsed.code === 'string') return { event, code: parsed.code };
  return null;
}

/**
 * Reads an answer's server-sent events into frames, ending at the first `final` or `error`.
 * Comments (the service's `: ping`) are skipped; CRLF line ends are read as LF.
 */
export async function* readAnswerStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AnswerFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replaceAll('\r\n', '\n');
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const frame = toFrame(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (frame === null) {
          yield ENDED;
          return;
        }
        if (frame !== 'skip') {
          yield frame;
          if (frame.event !== 'delta') return;
        }
        end = buffer.indexOf('\n\n');
      }
    }
    yield ENDED;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
