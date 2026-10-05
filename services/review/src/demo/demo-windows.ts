import { DemoWindows } from '@adili/api-kit';

import { config } from '../config.js';

/**
 * The service's demo windows (#371) as they stand now: from `DEMO_*_WINDOW` at start, changed
 * while it runs only through `PUT /v1/demo/windows`, which exists in demo mode alone. Every
 * window is the legal one unless the service runs with `DEMO_MODE=true`.
 */
export const demoWindows = new DemoWindows({
  DEMO_CLARIFICATION_REPLY_WINDOW: config.DEMO_CLARIFICATION_REPLY_WINDOW,
  DEMO_LADDER_NOTICE_WINDOW: config.DEMO_LADDER_NOTICE_WINDOW,
  DEMO_LADDER_WARNING_WINDOW: config.DEMO_LADDER_WARNING_WINDOW,
  DEMO_LADDER_STOPPAGE_WINDOW: config.DEMO_LADDER_STOPPAGE_WINDOW,
  DEMO_CASE_ISSUE_WINDOW: config.DEMO_CASE_ISSUE_WINDOW,
});
