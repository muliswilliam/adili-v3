import { demoSignIn } from '@adili/demo-auth';

import type { SeedConfig } from './config.js';

/** An access token and when the sign-in behind it happened. */
export interface UserToken {
  accessToken: string;
  /** Epoch ms when the token stops working. */
  expiresAt: number;
  /** Epoch ms of the sign-in: a step-up counts for 5 minutes from it (spec 06). */
  signedInAt: number;
}

export type SignIn = (demoKey: string) => Promise<UserToken>;

/**
 * Demo accounts' tokens, signed in the way the role switcher does it (#616): a demo ticket
 * through the portal client's code flow, so each token is a real step-up sign-in with the
 * account's own claims. Tokens are reused while they have a minute left, and a caller that is
 * about to do something needing a fresh step-up (submit, confirm) asks for `fresh`.
 */
export class Tokens {
  private readonly cache = new Map<string, Promise<UserToken>>();

  constructor(private readonly signIn: SignIn) {}

  async user(demoKey: string, { fresh = false }: { fresh?: boolean } = {}): Promise<string> {
    const cached = this.cache.get(demoKey);
    if (cached) {
      const token = await cached.catch(() => undefined);
      const now = Date.now();
      const usable =
        token !== undefined &&
        token.expiresAt - now > 60_000 &&
        (!fresh || now - token.signedInAt < 180_000);
      if (usable) return token.accessToken;
    }
    const next = this.signIn(demoKey);
    this.cache.set(demoKey, next);
    return (await next).accessToken;
  }
}

export function demoTicketSignIn(config: SeedConfig): SignIn {
  return async (demoKey) => {
    const tokens = await demoSignIn({
      issuerUrl: `${config.KEYCLOAK_URL}/realms/${config.KEYCLOAK_REALM}`,
      clientId: config.DEMO_SIGN_IN_CLIENT_ID,
      clientSecret: config.DEMO_SIGN_IN_CLIENT_SECRET,
      redirectUri: config.DEMO_SIGN_IN_REDIRECT_URI,
      demoKey,
      ticketSecret: config.DEMO_TICKET_SECRET,
    });
    const now = Date.now();
    return {
      accessToken: tokens.accessToken,
      expiresAt: now + tokens.expiresInSeconds * 1000,
      signedInAt: tokens.authTime ? tokens.authTime * 1000 : now,
    };
  };
}
