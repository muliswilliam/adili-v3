import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockFetch, mockableClient, withDeadline } from '../src/client/index.js';

interface Paths {
  '/things': { get: { responses: { 200: { content: { 'application/json': { ok: true } } } } } };
}

const answer = () => Promise.resolve(Response.json({ ok: true }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('withDeadline', () => {
  it('hands fetch a timeout signal in its init, per request when asked', async () => {
    const inits: RequestInit[] = [];
    const send = withDeadline(
      (_request, init) => {
        inits.push(init);
        return answer();
      },
      (request) => (request.method === 'GET' ? 5 : 50),
    );

    await send(new Request('http://service.test/things'));

    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(inits[0]?.signal?.aborted).toBe(true);
  });

  it("keeps the caller's abort: the request's own signal still cancels the call", async () => {
    const inits: RequestInit[] = [];
    const send = withDeadline((_request, init) => {
      inits.push(init);
      return answer();
    }, 60_000);
    const caller = new AbortController();

    await send(new Request('http://service.test/things', { signal: caller.signal }));
    const reason = new Error('loader cancelled');
    caller.abort(reason);

    expect(inits[0]?.signal?.aborted).toBe(true);
    expect(inits[0]?.signal?.reason).toBe(reason);
  });
});

describe('mockableClient', () => {
  it('calls the service with the headers and a deadline', async () => {
    const seen: [Request, RequestInit | undefined][] = [];
    const client = mockableClient<Paths>({
      baseUrl: 'http://service.test',
      headers: { authorization: 'Bearer t' },
      timeoutMs: 1_000,
      fetch: (input, init) => {
        seen.push([input as Request, init]);
        return answer();
      },
    });

    const { data } = await client.GET('/things');

    expect(data).toEqual({ ok: true });
    const [request, init] = seen[0] ?? [];
    expect(request?.url).toBe('http://service.test/things');
    expect(request?.headers.get('authorization')).toBe('Bearer t');
    expect(request?.headers.get('accept')).toBe('application/json');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers from the mock, which production ignores', async () => {
    const real = vi.fn(answer);
    const mock = vi.fn<MockFetch>(answer);
    const options = { baseUrl: 'http://service.test', timeoutMs: 1_000, mock, fetch: real };

    await mockableClient<Paths>(options).GET('/things');
    vi.stubEnv('NODE_ENV', 'production');
    await mockableClient<Paths>(options).GET('/things');

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(real).toHaveBeenCalledTimes(1);
  });
});
