/** Codes as the demo inboxes received them: the SMS mock and Mailpit. */

export interface SmsCode {
  code: string;
  messageId: string;
}

export async function latestSmsCode(mocksUrl: string, to: string): Promise<SmsCode | undefined> {
  const response = await fetch(`${mocksUrl}/sms/otp?to=${encodeURIComponent(to)}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`SMS mock answered ${response.status}`);
  const body = (await response.json()) as { code: string; message_id: string };
  return { code: body.code, messageId: body.message_id };
}

interface MailpitSearch {
  messages: { ID: string; Subject: string; Created: string }[];
}

/** Latest message to `to` whose subject matches, newest first. */
export async function latestEmail(
  mailpitUrl: string,
  to: string,
  subject: RegExp,
): Promise<{ id: string; subject: string; text: string } | undefined> {
  const response = await fetch(
    `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
  );
  if (!response.ok) throw new Error(`Mailpit answered ${response.status}`);
  const { messages } = (await response.json()) as MailpitSearch;
  const match = messages.find((message) => subject.test(message.Subject));
  if (!match) return undefined;
  const message = await fetch(`${mailpitUrl}/api/v1/message/${match.ID}`);
  const body = (await message.json()) as { Subject: string; Text: string };
  return { id: match.ID, subject: body.Subject, text: body.Text };
}

/** Polls until `read` returns something different from `previous`. */
export async function waitForNew<T>(
  read: () => Promise<T | undefined>,
  previous: T | undefined,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined && JSON.stringify(value) !== JSON.stringify(previous)) return value;
    if (Date.now() > deadline) throw new Error('nothing new arrived in time');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
