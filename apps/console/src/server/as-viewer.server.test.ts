import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withViewerClient } from './as-viewer.server';

const getSession = vi.fn<() => Promise<{ accessToken: string } | null>>();

vi.mock('@tanstack/react-start/server', () => ({ getRequest: () => new Request('http://x.test') }));
vi.mock('./bff.server', () => ({ getBff: () => ({ getSession }) }));

describe('withViewerClient', () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("runs the work with a client made for the viewer's access token", async () => {
    getSession.mockResolvedValue({ accessToken: 'token-1' });
    const createClient = vi.fn((accessToken: string) => ({ accessToken }));

    const result = await withViewerClient(createClient, (client) =>
      Promise.resolve({ ok: true as const, data: client.accessToken }),
    );

    expect(result).toEqual({ ok: true, data: 'token-1' });
    expect(createClient).toHaveBeenCalledWith('token-1');
  });

  it('answers unauthenticated without making a client when there is no session', async () => {
    getSession.mockResolvedValue(null);
    const createClient = vi.fn();
    const work = vi.fn();

    expect(await withViewerClient(createClient, work)).toEqual({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });
});
