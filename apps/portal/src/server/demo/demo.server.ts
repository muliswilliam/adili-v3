import {
  createDemoSwitch,
  DEMO_ACCOUNTS,
  type DemoSwitch,
  publishDemoSwitch,
} from '@adili/demo-auth';
import type { DemoBarAccount } from '@adili/ui';

import { getBff } from '../bff.server';
import { env } from '../env.server';

let demo: DemoSwitch | undefined;

/**
 * The demo role switcher (#616), or null outside demo mode: every demo route and the banner check
 * this first, so with `DEMO_MODE` off none of it runs.
 */
export function getDemoSwitch(): DemoSwitch | null {
  const config = env();
  if (!config.DEMO_MODE) return null;
  if (!config.DEMO_TICKET_SECRET) {
    throw new Error('DEMO_MODE needs DEMO_TICKET_SECRET (Keycloak demo-ticket-secret)');
  }
  demo ??= createDemoSwitch({
    app: 'portal',
    bff: getBff(),
    appUrl: config.APP_URL,
    ticketSecret: config.DEMO_TICKET_SECRET,
    record: (event) => publishDemoSwitch(config.RABBITMQ_URL, event),
    log: (message, error) => {
      console.error(message, error);
    },
  });
  return demo;
}

/** What the demo banner shows (#616); null outside demo mode, so nothing renders. */
export interface DemoState {
  accounts: DemoBarAccount[];
  current: string | null;
}

export async function loadDemoState(request: Request): Promise<DemoState | null> {
  const demo = getDemoSwitch();
  if (!demo) return null;
  return {
    accounts: DEMO_ACCOUNTS.filter((account) => account.app === 'portal').map(
      ({ demoKey, name, role, organisation, purpose }) => ({
        demoKey,
        name,
        role,
        organisation,
        purpose,
      }),
    ),
    current: await demo.currentDemoKey(request),
  };
}
