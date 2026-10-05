import { DEMO_CHECKPOINTS } from '@adili/demo-auth';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import {
  DEMO_REGISTRIES,
  type DemoPanelState,
  type DemoResetResult,
  loadDemoPanel,
  requestDemoReset,
  setRegistryPaused,
} from './panel.server';

export type { DemoPanelState, DemoRegistryState, DemoResetResult } from './panel.server';

/** The demo panel's checkpoints and registries (#621); null outside demo mode. */
export const getDemoPanel = createServerFn({ method: 'GET' }).handler(
  (): Promise<DemoPanelState | null> => loadDemoPanel(getRequest()),
);

const registryInput = z.object({
  system: z.enum(DEMO_REGISTRIES.map((registry) => registry.system)),
  paused: z.boolean(),
});

/** Pauses or resumes a registry mock; its state after, or null. */
export const setDemoRegistryPaused = createServerFn({ method: 'POST' })
  .validator(registryInput)
  .handler(({ data }): Promise<boolean | null> =>
    setRegistryPaused(getRequest(), data.system, data.paused),
  );

const resetInput = z.object({
  checkpoint: z.enum(DEMO_CHECKPOINTS.map((checkpoint) => checkpoint.name)),
});

/** Asks for a reset to a checkpoint (the console restarts with the stack); null when not allowed. */
export const resetDemo = createServerFn({ method: 'POST' })
  .validator(resetInput)
  .handler(({ data }): Promise<DemoResetResult | null> =>
    requestDemoReset(getRequest(), data.checkpoint),
  );
