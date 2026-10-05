import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = {
  APP_URL: 'http://localhost:3020',
  DEMO_MODE: false,
  DEMO_TICKET_SECRET: 'test-demo-ticket-secret' as string | undefined,
  RABBITMQ_URL: 'amqp://localhost',
};
vi.mock('../env.server', () => ({ env: () => config }));

const getSession = vi.fn<() => Promise<{ accessToken: string } | null>>();
vi.mock('../bff.server', () => ({ getBff: () => ({ getSession }) }));

const { getDemoSwitch, loadDemoState } = await import('./demo.server');
const { Route } = await import('../../routes/auth/demo-switch');

/** The switch route's POST handler, as TanStack Start calls it. */
function post(request: Request): Promise<Response> {
  const handlers = Route.options.server?.handlers as unknown as {
    POST: (context: { request: Request }) => Promise<Response> | Response;
  };
  return Promise.resolve(handlers.POST({ request }));
}

function switchRequest(as: string) {
  return new Request(`${config.APP_URL}/auth/demo-switch`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ as }),
  });
}

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue(null);
});

describe('demo mode off (#616)', () => {
  beforeEach(() => {
    config.DEMO_MODE = false;
  });

  it('has no switcher and no banner state', async () => {
    expect(getDemoSwitch()).toBeNull();
    expect(await loadDemoState(new Request(config.APP_URL))).toBeNull();
  });

  it('answers the switch route with 404', async () => {
    expect((await post(switchRequest('wanjiku'))).status).toBe(404);
  });
});

describe('demo mode on (#616)', () => {
  beforeEach(() => {
    config.DEMO_MODE = true;
  });

  it("lists this app's demo accounts and the signed-in one", async () => {
    const claims = Buffer.from(JSON.stringify({ demo_key: 'wanjiku' })).toString('base64url');
    getSession.mockResolvedValue({ accessToken: `e30.${claims}.sig` });

    const state = await loadDemoState(new Request(config.APP_URL));

    expect(state?.current).toBe('wanjiku');
    expect(state?.accounts.map((account) => account.demoKey)).toContain('wanjiku');
    expect(state?.accounts.map((account) => account.demoKey)).not.toContain('reviewer');
  });

  it("refuses the console's accounts on the switch route", async () => {
    expect((await post(switchRequest('reviewer'))).status).toBe(400);
  });
});
