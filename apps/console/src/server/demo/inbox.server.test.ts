import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = {
  APP_URL: 'http://localhost:3020',
  DEMO_MODE: false,
  DEMO_TICKET_SECRET: 'test-demo-ticket-secret' as string | undefined,
  DEMO_MOCKS_URL: 'http://mocks.test',
  DEMO_MAILPIT_URL: 'http://mailpit.test',
  RABBITMQ_URL: 'amqp://localhost',
};
vi.mock('../env.server', () => ({ env: () => config }));

const getSession = vi.fn<() => Promise<{ accessToken: string } | null>>();
vi.mock('../bff.server', () => ({ getBff: () => ({ getSession }) }));

const { loadDemoInbox } = await import('./inbox.server');

const request = () => new Request(config.APP_URL);
const fetchMock = vi.fn<typeof fetch>();
/** The inbox reader always fetches a URL object. */
const urlOf = (input: Parameters<typeof fetch>[0]) => input as URL;

function signedInAs(demoKey: string | null) {
  if (!demoKey) {
    getSession.mockResolvedValue(null);
    return;
  }
  const claims = Buffer.from(JSON.stringify({ demo_key: demoKey })).toString('base64url');
  getSession.mockResolvedValue({ accessToken: `e30.${claims}.sig` });
}

const sms = [
  {
    message_id: 'a',
    to: '+254700000001',
    sender_id: 'ADILI',
    message: 'Welcome to Adili',
    status: 'delivered',
    received_at: '2026-10-05T07:40:00Z',
  },
  {
    message_id: 'b',
    to: '+254700000002',
    sender_id: 'ADILI',
    message: 'Your Adili verification code is 482913. It expires in 10 minutes.',
    status: 'delivered',
    received_at: '2026-10-05T07:42:00Z',
  },
];

const mailpit = {
  messages: [
    {
      ID: 'm1',
      To: [{ Address: 'officer@psc.example' }],
      Subject: 'Your Adili verification code',
      Snippet: 'Use 551204 to verify your email address.',
      Created: '2026-10-05T07:41:00Z',
    },
  ],
};

beforeEach(() => {
  config.DEMO_MODE = true;
  signedInAs('reporting-officer');
  fetchMock.mockReset();
  fetchMock.mockImplementation((input) => {
    const url = urlOf(input);
    if (url.host === 'mocks.test' && url.pathname === '/sms') {
      return Promise.resolve(Response.json(sms));
    }
    if (url.host === 'mailpit.test' && url.pathname === '/api/v1/messages') {
      return Promise.resolve(Response.json(mailpit));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('demo inbox with demo mode off', () => {
  it('is absent and reads neither inbox', async () => {
    config.DEMO_MODE = false;
    expect(await loadDemoInbox(request())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('demo inbox', () => {
  it('is absent for someone not signed in with a demo account', async () => {
    signedInAs(null);
    expect(await loadDemoInbox(request())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists text messages newest first with their codes, and emails with theirs', async () => {
    const inbox = await loadDemoInbox(request());

    expect(inbox?.sms?.map((message) => [message.id, message.code])).toEqual([
      ['b', '482913'],
      ['a', null],
    ]);
    expect(inbox?.email).toEqual([
      {
        id: 'm1',
        to: 'officer@psc.example',
        subject: 'Your Adili verification code',
        text: 'Use 551204 to verify your email address.',
        code: '551204',
        receivedAt: '2026-10-05T07:41:00Z',
      },
    ]);
    const mailUrl = fetchMock.mock.calls
      .map(([input]) => urlOf(input))
      .find((url) => url.host === 'mailpit.test');
    expect(mailUrl?.searchParams.get('limit')).toBe('8');
  });

  it('says which inbox did not answer', async () => {
    fetchMock.mockImplementation((input) => {
      const url = urlOf(input);
      return url.host === 'mocks.test'
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve(Response.json(mailpit));
    });

    const inbox = await loadDemoInbox(request());

    expect(inbox?.sms).toBeNull();
    expect(inbox?.email).toHaveLength(1);
  });
});
