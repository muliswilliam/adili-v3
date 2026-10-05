import { createHmac, randomBytes } from 'node:crypto';

/**
 * Demo tickets, as Keycloak's `adili-demo` authenticator verifies them
 * (apps/keycloak-extension/src/main/java/ke/go/adili/keycloak/demo/DemoTicket.java; change both
 * together): `v1.<payload>.<signature>`, the payload base64url JSON `{k, exp, n}` (demo key, expiry
 * in epoch seconds, nonce) and the signature base64url HMAC-SHA256 over `v1.<payload>`.
 */
export const DEMO_TICKET_VERSION = 'v1';

/** The authorize request parameter Keycloak reads the ticket from. */
export const DEMO_TICKET_PARAM = 'demo_ticket';

/** Keycloak refuses tickets valid for longer (the authenticator's `maxLifetimeSeconds`). */
export const DEMO_TICKET_MAX_TTL_SECONDS = 120;

const DEMO_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface MintDemoTicketOptions {
  /** The account's `demo_key` user attribute, e.g. `reviewer` or `wanjiku`. */
  demoKey: string;
  /** The HMAC key, the same as Keycloak's `demo-ticket-secret` vault entry. */
  secret: string;
  /** Seconds the ticket is valid for; at most {@link DEMO_TICKET_MAX_TTL_SECONDS}. */
  ttlSeconds?: number;
  now?: Date;
  /** Fixed only in tests; a fresh random nonce makes each ticket single-use. */
  nonce?: string;
}

/** A single-use ticket that signs the demo account `demoKey` in at Keycloak. */
export function mintDemoTicket({
  demoKey,
  secret,
  ttlSeconds = 60,
  now = new Date(),
  nonce = randomBytes(18).toString('base64url'),
}: MintDemoTicketOptions): string {
  if (!DEMO_KEY.test(demoKey)) throw new Error(`invalid demo key ${demoKey}`);
  if (!secret) throw new Error('demo ticket secret is empty');
  if (ttlSeconds <= 0 || ttlSeconds > DEMO_TICKET_MAX_TTL_SECONDS) {
    throw new Error(`ttlSeconds must be 1-${DEMO_TICKET_MAX_TTL_SECONDS}`);
  }
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ k: demoKey, exp, n: nonce })).toString('base64url');
  const signed = `${DEMO_TICKET_VERSION}.${payload}`;
  return `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`;
}
