import type * as DemoAuth from '@adili/demo-auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = {
  APP_URL: 'http://localhost:3020',
  DEMO_MODE: false,
  DEMO_TICKET_SECRET: 'test-demo-ticket-secret' as string | undefined,
  DEMO_RESET_SCRIPT: undefined as string | undefined,
  DEMO_MOCKS_URL: 'http://mocks.test',
  RABBITMQ_URL: 'amqp://localhost',
  OIDC_ISSUER_URL: 'http://keycloak.test/realms/adili',
  OIDC_CLIENT_ID: 'console',
  OIDC_CLIENT_SECRET: 'console-secret',
  INTEGRATION_GATEWAY_API_URL: 'http://gateway.test',
};
vi.mock('../env.server', () => ({ env: () => config }));

const demoSignIn = vi.fn();
vi.mock('@adili/demo-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof DemoAuth>()),
  demoSignIn,
}));

const getSession = vi.fn<() => Promise<{ accessToken: string } | null>>();
vi.mock('../bff.server', () => ({ getBff: () => ({ getSession }) }));

const execFile =
  vi.fn<
    (
      file: string,
      args: string[],
      options: unknown,
      callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
    ) => void
  >();
vi.mock('node:child_process', () => ({ execFile }));

const { loadDemoPanel, requestDemoReset, setRegistryPaused } = await import('./panel.server');

const request = () => new Request(config.APP_URL);
const fetchMock = vi.fn<typeof fetch>();

function signedInAs(demoKey: string | null) {
  if (!demoKey) {
    getSession.mockResolvedValue(null);
    return;
  }
  const claims = Buffer.from(JSON.stringify({ demo_key: demoKey })).toString('base64url');
  getSession.mockResolvedValue({ accessToken: `e30.${claims}.sig` });
}

beforeEach(() => {
  config.DEMO_MODE = true;
  config.DEMO_RESET_SCRIPT = undefined;
  signedInAs('reviewer');
  execFile.mockReset();
  demoSignIn.mockReset();
  demoSignIn.mockResolvedValue({ accessToken: 'platform-admin-token', expiresInSeconds: 300 });
  fetchMock.mockReset();
  fetchMock.mockImplementation((input) =>
    Promise.resolve(
      Response.json(
        { system: (input instanceof URL ? input.href : '').split('/').at(-1), paused: false },
        { status: 200 },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

describe('demo panel with demo mode off (#621)', () => {
  beforeEach(() => {
    config.DEMO_MODE = false;
    config.DEMO_RESET_SCRIPT = '/opt/adili/infra/azure/demo-reset.sh';
  });

  it('is absent, and neither resets nor touches a registry', async () => {
    expect(await loadDemoPanel(request())).toBeNull();
    expect(await requestDemoReset(request(), '0-start')).toBeNull();
    expect(await setRegistryPaused(request(), 'kra', true)).toBeNull();
    expect(execFile).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('demo panel (#621)', () => {
  it('is absent for someone not signed in with a demo account', async () => {
    signedInAs(null);
    expect(await loadDemoPanel(request())).toBeNull();
    expect(await requestDemoReset(request(), '0-start')).toBeNull();
  });

  it('lists the checkpoints and each registry mock with its state', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        Response.json({ paused: input instanceof URL && input.href.endsWith('/kra') }),
      ),
    );

    const panel = await loadDemoPanel(request());

    expect(panel?.checkpoints.map((checkpoint) => checkpoint.name)).toEqual([
      '0-start',
      '1-after-filing',
      '2-after-review',
      '3-form-m-ready',
    ]);
    expect(panel?.registries).toEqual([
      { system: 'kra', label: 'KRA', paused: true },
      { system: 'ntsa', label: 'NTSA', paused: false },
      { system: 'brs', label: 'BRS', paused: false },
      { system: 'ardhisasa', label: 'ArdhiSasa', paused: false },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://mocks.test/demo/registries/kra'),
      expect.anything(),
    );
  });

  it('shows a registry as unknown when the mocks do not answer', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const panel = await loadDemoPanel(request());
    expect(panel?.registries.every((registry) => registry.paused === null)).toBe(true);
  });

  /** Every call the panel made: where to, and with whose token. */
  const calls = () =>
    fetchMock.mock.calls.map(([input, init]) => {
      const url = input instanceof Request ? input.url : String(input);
      const headers = input instanceof Request ? input.headers : new Headers(init?.headers);
      return { url, authorization: headers.get('authorization') };
    });

  it('pauses and resumes a registry through the mocks and, as the platform admin, the gateway (#477)', async () => {
    expect(await setRegistryPaused(request(), 'ntsa', true)).toBe(true);
    expect(await setRegistryPaused(request(), 'ntsa', false)).toBe(false);

    expect(calls()).toEqual(
      expect.arrayContaining([
        { url: 'http://mocks.test/demo/registries/ntsa/pause', authorization: null },
        {
          url: 'http://gateway.test/v1/integrations/ntsa/pause',
          authorization: 'Bearer platform-admin-token',
        },
        { url: 'http://mocks.test/demo/registries/ntsa/resume', authorization: null },
        {
          url: 'http://gateway.test/v1/integrations/ntsa/resume',
          authorization: 'Bearer platform-admin-token',
        },
      ]),
    );
    expect(calls()).toHaveLength(4);
    // Signed in once, as the platform admin through the console's client, and reused.
    expect(demoSignIn).toHaveBeenCalledTimes(1);
    expect(demoSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        demoKey: 'platform-admin',
        clientId: 'console',
        redirectUri: 'http://localhost:3020/auth/callback',
      }),
    );
  });

  it('answers null when the gateway does not pause the registry', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        input instanceof Request && input.url.startsWith('http://gateway.test')
          ? Response.json({ type: 'forbidden', status: 403 }, { status: 403 })
          : Response.json({ paused: true }),
      ),
    );

    expect(await setRegistryPaused(request(), 'kra', true)).toBeNull();
  });

  it('offers the command, not a button, without a reset script (a local stack)', async () => {
    expect((await loadDemoPanel(request()))?.reset).toBe('command');
    expect(await requestDemoReset(request(), '0-start')).toEqual({
      ok: false,
      message: 'Run pnpm demo:reset 0-start with pnpm dev stopped.',
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  describe('with a reset script (the Azure host)', () => {
    beforeEach(() => {
      config.DEMO_RESET_SCRIPT = '/opt/adili/infra/azure/demo-reset.sh';
    });

    it('asks the script for a detached reset', async () => {
      execFile.mockImplementation((_file, _args, _options, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      expect((await loadDemoPanel(request()))?.reset).toBe('button');
      expect(await requestDemoReset(request(), '1-after-filing')).toEqual({ ok: true });
      expect(execFile).toHaveBeenCalledWith(
        '/opt/adili/infra/azure/demo-reset.sh',
        ['--detach', '1-after-filing'],
        expect.anything(),
        expect.any(Function),
      );
    });

    it("answers the script's reason when it refuses", async () => {
      execFile.mockImplementation((_file, _args, _options, callback) => {
        callback(
          Object.assign(new Error('exit 1'), {
            stderr: 'No complete checkpoint 2-after-review on this host:\n',
          }),
        );
      });

      expect(await requestDemoReset(request(), '2-after-review')).toEqual({
        ok: false,
        message: 'No complete checkpoint 2-after-review on this host:',
      });
    });

    it('refuses a name that is no checkpoint', async () => {
      expect(await requestDemoReset(request(), '../etc')).toEqual({
        ok: false,
        message: 'No checkpoint ../etc.',
      });
      expect(execFile).not.toHaveBeenCalled();
    });
  });
});
