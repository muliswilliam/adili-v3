import { describe, expect, it } from 'vitest';

import { callDirectory, toFailure } from './result';

const problem = {
  type: 'https://adili.go.ke/problems/forbidden',
  title: 'Forbidden',
  status: 403,
  detail: 'Only EACC staff can list Commissions.',
};

describe('toFailure', () => {
  it('maps statuses to the kinds screens branch on, keeping problem bodies', () => {
    expect(toFailure(401, null)).toEqual({ kind: 'unauthenticated' });
    expect(toFailure(403, problem)).toEqual({ kind: 'forbidden', problem });
    expect(toFailure(404, null)).toEqual({ kind: 'not-found', problem: null });
    expect(toFailure(409, null).kind).toBe('conflict');
    expect(toFailure(400, null).kind).toBe('invalid');
    expect(toFailure(422, null).kind).toBe('invalid');
    expect(toFailure(503, null).kind).toBe('unavailable');
  });

  it('drops bodies that are not problem details', () => {
    expect(toFailure(500, '<html>Bad gateway</html>')).toEqual({
      kind: 'unavailable',
      problem: null,
    });
  });
});

describe('callDirectory', () => {
  it('returns data on success', async () => {
    const result = await callDirectory(() =>
      Promise.resolve({ data: { items: [] }, response: new Response(null, { status: 200 }) }),
    );
    expect(result).toEqual({ ok: true, data: { items: [] } });
  });

  it('maps problem responses', async () => {
    const result = await callDirectory(() =>
      Promise.resolve({ error: problem, response: new Response(null, { status: 403 }) }),
    );
    expect(result).toEqual({ ok: false, failure: { kind: 'forbidden', problem } });
  });

  it('treats transport errors as unavailable', async () => {
    const result = await callDirectory(() => Promise.reject(new TypeError('fetch failed')));
    expect(result).toEqual({ ok: false, failure: { kind: 'unavailable', problem: null } });
  });
});
