import { type Bff, safeReturnTo } from '@adili/bff-auth';

import { type DemoApp, demoAccount } from './accounts.ts';
import { type DemoSwitchAccount, demoSwitchEvent, type DemoSwitchEvent } from './audit.ts';
import { DEMO_TICKET_PARAM, mintDemoTicket } from './ticket.ts';

export interface DemoSwitchOptions {
  app: DemoApp;
  bff: Bff;
  appUrl: string;
  /** Keycloak's `demo-ticket-secret`. */
  ticketSecret: string;
  /** Records the switch in the audit trail; a switch that cannot be recorded does not happen. */
  record: (event: DemoSwitchEvent) => Promise<void>;
  log?: (message: string, error: unknown) => void;
}

/** Claims of the session's access token the switcher reads. */
interface AccessClaims {
  sub?: string;
  preferred_username?: string;
  tenant?: string;
  demo_key?: string;
  realm_access?: { roles?: string[] };
}

/**
 * The demo role switcher's server side (#616), for an app's BFF in demo mode: `switchAccount`
 * answers `POST /auth/demo-switch` (form field `as`, a demo key), and `enter` answers the deck's
 * `GET /auth/demo-enter` deep link.
 */
export function createDemoSwitch(options: DemoSwitchOptions) {
  const appOrigin = new URL(options.appUrl).origin;

  async function currentClaims(request: Request): Promise<AccessClaims | null> {
    const session = await options.bff.getSession(request);
    return session ? decodeClaims(session.accessToken) : null;
  }

  /** Records the switch, then signs in afresh as `demoKey`, landing on `returnTo`. */
  async function switchTo(
    request: Request,
    account: { demoKey: string },
    returnTo?: string,
  ): Promise<Response> {
    const from = await currentClaims(request);
    const to: DemoSwitchAccount = {
      username: account.demoKey,
      subject: null,
      tenant: null,
      roles: [],
    };
    try {
      await options.record(
        demoSwitchEvent({
          app: options.app,
          from: from ? accountOf(from) : null,
          to,
          outcome: 'success',
        }),
      );
    } catch (error) {
      options.log?.('demo switch not recorded in the audit trail; not switched', error);
      return new Response('The switch could not be recorded. Try again.', { status: 503 });
    }
    return options.bff.signInAfresh(request, {
      authorizeParams: {
        [DEMO_TICKET_PARAM]: mintDemoTicket({
          demoKey: account.demoKey,
          secret: options.ticketSecret,
        }),
      },
      ...(returnTo === undefined ? {} : { returnTo }),
    });
  }

  return {
    async switchAccount(request: Request): Promise<Response> {
      const origin = request.headers.get('origin');
      if (origin && origin !== appOrigin) {
        return new Response('Cross-origin switch refused', { status: 403 });
      }
      // A plain form post (application/x-www-form-urlencoded) from the switcher menu.
      const demoKey = new URLSearchParams(await request.text()).get('as');
      const account = demoKey ? demoAccount(options.app, demoKey) : undefined;
      if (!account) return new Response('Unknown demo account', { status: 400 });
      return switchTo(request, account);
    },

    /**
     * `GET /auth/demo-enter?as=<demo key>&next=<path>`: the presentation deck's deep link into a
     * view as a demo account. Already signed in as that account, it only redirects to `next`;
     * otherwise it switches (recorded like any switch) and lands on `next`. A `next` that is not
     * a path on this app lands on `/`.
     */
    async enter(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const demoKey = url.searchParams.get('as');
      const account = demoKey ? demoAccount(options.app, demoKey) : undefined;
      if (!account) return new Response('Unknown demo account', { status: 400 });
      const next = safeReturnTo(url.searchParams.get('next'));
      if ((await currentClaims(request))?.demo_key === account.demoKey) {
        return new Response(null, {
          status: 303,
          headers: { location: next, 'cache-control': 'no-store' },
        });
      }
      return switchTo(request, account, next);
    },

    /** The signed-in demo account's key, or null (signed out, or not a demo account). */
    async currentDemoKey(request: Request): Promise<string | null> {
      return (await currentClaims(request))?.demo_key ?? null;
    },
  };
}

export type DemoSwitch = ReturnType<typeof createDemoSwitch>;

/**
 * The BFF's `authorizeParams` in demo mode: a demo account's step-up gets a fresh ticket, so it
 * needs no code either (Keycloak passes it without a page).
 */
export async function demoStepUpParams(
  bff: Bff,
  request: Request,
  kind: 'login' | 'step-up',
  ticketSecret: string,
): Promise<Record<string, string> | undefined> {
  if (kind !== 'step-up') return undefined;
  const session = await bff.getSession(request);
  const demoKey = session ? decodeClaims(session.accessToken).demo_key : undefined;
  if (!demoKey) return undefined;
  return { [DEMO_TICKET_PARAM]: mintDemoTicket({ demoKey, secret: ticketSecret }) };
}

function accountOf(claims: AccessClaims): DemoSwitchAccount {
  return {
    username: claims.demo_key ?? claims.preferred_username ?? 'unknown',
    subject: claims.sub ?? null,
    tenant: claims.tenant ?? null,
    roles: (claims.realm_access?.roles ?? []).filter((role) => !role.startsWith('default-roles')),
  };
}

/** The payload of our own session's access token; Keycloak signed it, the services verify it. */
function decodeClaims(accessToken: string): AccessClaims {
  try {
    return JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString(),
    ) as AccessClaims;
  } catch {
    return {};
  }
}
