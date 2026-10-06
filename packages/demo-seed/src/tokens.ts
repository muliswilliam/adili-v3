import { demoAccount, type DemoApp, demoSignIn } from '@adili/demo-auth';

import type { SeedConfig } from './config.js';
import { PERSONAS, TIMED_OFFICERS } from './data/personas.js';
import { REFERRAL_OFFICER } from './data/review.js';
import { syntheticDemoKey } from './steps/onboarding.js';

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
 * The `demo_key`s of the officers the seed onboards (`onboardees`): declarants, all of them,
 * beside the synthetic officers' generated keys.
 */
const DECLARANT_KEYS: ReadonlySet<string> = new Set([
  ...PERSONAS.map((persona) => persona.demoKey),
  ...TIMED_OFFICERS.map((officer) => officer.demoKey),
  REFERRAL_OFFICER.demoKey,
]);
const SYNTHETIC_PREFIX = syntheticDemoKey('');

/**
 * The app a demo account signs in through, as a person would: declarants and the public through
 * the portal (the switcher's portal accounts, the personas, the timed and synthetic officers),
 * everyone else, Commission and EACC staff including the ones the seed adds, through the console.
 * The token's client (`azp`) is what the audit trail records as the channel of every read.
 */
export function signInAppOf(demoKey: string): DemoApp {
  return demoAccount('portal', demoKey) !== undefined ||
    DECLARANT_KEYS.has(demoKey) ||
    demoKey.startsWith(SYNTHETIC_PREFIX)
    ? 'portal'
    : 'console';
}

/**
 * Demo accounts' tokens, signed in the way the role switcher does it (#616): a demo ticket
 * through the code flow of the account's app's client (`signInAppOf`), so each token is a real step-up sign-in with the
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
    const client =
      signInAppOf(demoKey) === 'console'
        ? {
            clientId: config.DEMO_CONSOLE_SIGN_IN_CLIENT_ID,
            clientSecret: config.DEMO_CONSOLE_SIGN_IN_CLIENT_SECRET,
            redirectUri: config.DEMO_CONSOLE_SIGN_IN_REDIRECT_URI,
          }
        : {
            clientId: config.DEMO_SIGN_IN_CLIENT_ID,
            clientSecret: config.DEMO_SIGN_IN_CLIENT_SECRET,
            redirectUri: config.DEMO_SIGN_IN_REDIRECT_URI,
          };
    const tokens = await demoSignIn({
      issuerUrl: `${config.KEYCLOAK_URL}/realms/${config.KEYCLOAK_REALM}`,
      ...client,
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
