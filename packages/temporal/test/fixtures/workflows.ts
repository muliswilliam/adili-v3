import { proxyActivities, sleep } from '@temporalio/workflow';

import type { GreetingActivities } from './greeting-activities.js';

const { composeGreeting } = proxyActivities<GreetingActivities>({
  startToCloseTimeout: '1 minute',
});

/** Waits a day (skipped in time-skipping tests), then asks an activity for the greeting. */
export async function greet(name: string): Promise<string> {
  await sleep('1 day');
  return composeGreeting(name);
}

/** Asks an activity for the greeting straight away. */
export async function greetNow(name: string): Promise<string> {
  return composeGreeting(name);
}
