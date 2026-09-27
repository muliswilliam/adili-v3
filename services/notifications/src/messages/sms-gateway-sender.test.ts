import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { SmsGatewaySender } from './sms-gateway-sender.js';

let server: Server | undefined;

/** A gateway that answers every request with `status` and `body`. */
async function gateway(status: number, body: unknown): Promise<SmsGatewaySender> {
  server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return new SmsGatewaySender({ url: `http://127.0.0.1:${port}/messages`, senderId: 'ADILI' });
}

const message = { to: '+254712345678', text: 'Your code is 771204' };

describe('SmsGatewaySender', () => {
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  it('returns the gateway message id', async () => {
    const sender = await gateway(201, { message_id: 'sms-1' });

    await expect(sender.send(message, AbortSignal.timeout(5_000))).resolves.toEqual({
      providerMessageId: 'sms-1',
    });
  });

  it('reports a 400 naming the recipient as a rejected recipient', async () => {
    const sender = await gateway(400, { to: ['not a valid phone number'] });

    await expect(sender.send(message, AbortSignal.timeout(5_000))).rejects.toMatchObject({
      reason: 'rejected-recipient',
    });
  });

  it('reports a 400 about other fields as a provider error', async () => {
    const sender = await gateway(400, { to: [], message: ['too long'] });

    await expect(sender.send(message, AbortSignal.timeout(5_000))).rejects.toMatchObject({
      reason: 'provider-error',
    });
  });
});
