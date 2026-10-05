import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = {
  APP_URL: 'http://localhost:3020',
  DEMO_MODE: true,
  DEMO_TICKET_SECRET: 'test-demo-ticket-secret' as string | undefined,
  DEMO_MOCKS_URL: 'http://mocks.test',
  RABBITMQ_URL: 'amqp://localhost',
};
vi.mock('../env.server', () => ({ env: () => config }));

const getSession = vi.fn<() => Promise<{ accessToken: string } | null>>();
vi.mock('../bff.server', () => ({ getBff: () => ({ getSession }) }));

const { demoFileResponse } = await import('./files.server');

const request = () => new Request(`${config.APP_URL}/demo/files/psc-roster.csv`);
const fetchMock = vi.fn<typeof fetch>();
const ROSTER = 'personnel_file_number,full_name\nPSC/2012/0311,Lydia Kwamboka Nyaboke\n';

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
  signedInAs('reporting-officer');
  fetchMock.mockReset();
  fetchMock.mockImplementation((input) => {
    const url = input as URL;
    return Promise.resolve(
      url.href === 'http://mocks.test/demo/files/psc-roster.csv'
        ? new Response(ROSTER, { headers: { 'content-type': 'text/csv' } })
        : new Response(null, { status: 404 }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('demo files (#679)', () => {
  it("serves the stack's own roster file as an attachment", async () => {
    const response = await demoFileResponse(request(), 'psc-roster.csv');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="psc-roster.csv"',
    );
    expect(await response.text()).toBe(ROSTER);
  });

  it('serves only the files the panel offers', async () => {
    const response = await demoFileResponse(request(), '..%2Fsettings.py');

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a 404 outside demo mode or without a demo account', async () => {
    signedInAs(null);
    expect((await demoFileResponse(request(), 'psc-roster.csv')).status).toBe(404);
    config.DEMO_MODE = false;
    signedInAs('reporting-officer');
    expect((await demoFileResponse(request(), 'psc-roster.csv')).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says when the mocks do not answer', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    expect((await demoFileResponse(request(), 'psc-roster.csv')).status).toBe(502);
  });
});
