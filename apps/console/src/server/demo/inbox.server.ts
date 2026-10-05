import { env } from '../env.server';
import { getDemoSwitch } from './demo.server';

/**
 * The demo panel's inbox (#371): the codes the stack has just sent by SMS (the SMS mock) and email
 * (Mailpit), so a presenter can onboard an officer live on the hosted demo, where neither inbox is
 * published. A thin read of the two inboxes' own APIs. Demo mode and a signed-in demo account only:
 * null otherwise.
 */

/** Messages per inbox the panel shows, newest first. */
export const DEMO_INBOX_LIMIT = 8;

export interface DemoSms {
  id: string;
  to: string;
  text: string;
  /** The 6-digit code in the message, if any. */
  code: string | null;
  receivedAt: string;
}

export interface DemoEmail {
  id: string;
  to: string;
  subject: string;
  /** Mailpit's preview of the body. */
  text: string;
  code: string | null;
  receivedAt: string;
}

export interface DemoInbox {
  /** null when the SMS mock did not answer. */
  sms: DemoSms[] | null;
  /** null when Mailpit did not answer. */
  email: DemoEmail[] | null;
}

const CODE = /\b(\d{6})\b/;

function codeIn(text: string): string | null {
  return CODE.exec(text)?.[1] ?? null;
}

export async function loadDemoInbox(request: Request): Promise<DemoInbox | null> {
  const demo = getDemoSwitch();
  if (!demo || !(await demo.currentDemoKey(request))) return null;
  const { DEMO_MOCKS_URL, DEMO_MAILPIT_URL } = env();
  const [sms, email] = await Promise.all([readSms(DEMO_MOCKS_URL), readEmail(DEMO_MAILPIT_URL)]);
  return { sms, email };
}

interface MockSms {
  message_id: string;
  to: string;
  message: string;
  received_at: string;
}

async function readSms(mocksUrl: string): Promise<DemoSms[] | null> {
  const body = await getJson<MockSms[] | { results?: MockSms[] }>(
    new URL('sms', withSlash(mocksUrl)),
  );
  if (!body) return null;
  const messages = Array.isArray(body) ? body : (body.results ?? []);
  return messages
    .toSorted((a, b) => b.received_at.localeCompare(a.received_at))
    .slice(0, DEMO_INBOX_LIMIT)
    .map((message) => ({
      id: message.message_id,
      to: message.to,
      text: message.message,
      code: codeIn(message.message),
      receivedAt: message.received_at,
    }));
}

interface MailpitList {
  messages?: {
    ID: string;
    To?: { Address: string }[];
    Subject: string;
    Snippet: string;
    Created: string;
  }[];
}

async function readEmail(mailpitUrl: string): Promise<DemoEmail[] | null> {
  const url = new URL('api/v1/messages', withSlash(mailpitUrl));
  url.searchParams.set('limit', String(DEMO_INBOX_LIMIT));
  const body = await getJson<MailpitList>(url);
  if (!body) return null;
  return (body.messages ?? []).map((message) => ({
    id: message.ID,
    to: message.To?.map((to) => to.Address).join(', ') ?? '',
    subject: message.Subject,
    text: message.Snippet,
    code: codeIn(`${message.Subject} ${message.Snippet}`),
    receivedAt: message.Created,
  }));
}

async function getJson<T>(url: URL): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
