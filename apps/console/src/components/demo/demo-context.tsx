import { DemoBar } from '@adili/ui';
import { createContext, useContext } from 'react';

import type { DemoState } from '../../server/demo/demo';

/** The demo banner's state (#616), from the root route; null outside demo mode. */
export const DemoContext = createContext<DemoState | null>(null);

/** The demo switcher in the signed-in shell's top bar; nothing outside demo mode. */
export function ShellDemoBar() {
  const demo = useContext(DemoContext);
  return demo ? <DemoBar variant="inline" accounts={demo.accounts} current={demo.current} /> : null;
}
