import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { type DemoState, loadDemoState } from './demo.server';

export type { DemoState };

/** The demo banner's accounts and the signed-in one (#616); null outside demo mode. */
export const getDemo = createServerFn({ method: 'GET' }).handler((): Promise<DemoState | null> =>
  loadDemoState(getRequest()),
);
