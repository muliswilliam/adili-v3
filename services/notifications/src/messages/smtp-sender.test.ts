import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SmtpSender } from './smtp-sender.js';

/** A plaintext SMTP server that never offers STARTTLS and accepts every message. */
function plaintextSmtpServer(): Server {
  return createServer((socket) => {
    socket.write('220 test ESMTP\r\n');
    let data = false;
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\r\n').filter(Boolean)) {
        if (data) {
          if (line === '.') {
            data = false;
            socket.write('250 OK queued as test-1\r\n');
          }
        } else if (/^(EHLO|HELO)/i.test(line)) {
          socket.write('250 test\r\n');
        } else if (/^DATA/i.test(line)) {
          data = true;
          socket.write('354 go ahead\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
}

describe('SmtpSender', () => {
  const server = plaintextSmtpServer();
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const sender = (requireTls: boolean) =>
    new SmtpSender({
      host: '127.0.0.1',
      port,
      from: 'Adili Online <no-reply@adili.go.ke>',
      timeoutMs: 2_000,
      requireTls,
    });
  const message = { to: 'someone@example.go.ke', subject: 'Code', text: '123456' };

  it('sends in plaintext when TLS is not required', async () => {
    const smtp = sender(false);

    await expect(smtp.send(message, new AbortController().signal)).resolves.toMatchObject({
      providerMessageId: expect.any(String) as string,
    });
    smtp.onApplicationShutdown();
  });

  it('refuses to send in plaintext when TLS is required', async () => {
    const smtp = sender(true);

    await expect(smtp.send(message, new AbortController().signal)).rejects.toThrow();
    smtp.onApplicationShutdown();
  });
});
