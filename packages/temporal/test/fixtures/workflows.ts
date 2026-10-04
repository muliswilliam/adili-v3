import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';

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

export const nudge = defineSignal<[string]>('nudge');
export const lastNudge = defineQuery<string | null>('lastNudge');

/** Waits for a `nudge` signal and returns its text; `lastNudge` reads it meanwhile. */
export async function awaitNudge(): Promise<string> {
  const received: { text: string | null } = { text: null };
  setHandler(nudge, (value) => {
    received.text = value;
  });
  setHandler(lastNudge, () => received.text);
  await condition(() => received.text !== null);
  return received.text ?? '';
}

/**
 * Counts `nudge` signals, waiting for each with an hourly recheck (a timer each signal cancels),
 * and returns once `count` have come.
 */
export async function countNudges(count: number): Promise<number> {
  let received = 0;
  setHandler(nudge, () => {
    received += 1;
  });
  for (let seen = 0; seen < count;) {
    if (await condition(() => received > seen, '1 hour')) seen = received;
  }
  return received;
}
