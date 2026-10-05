import { describe, expect, it } from 'vitest';

import { DemoWindowsController } from '../src/demo/demo-windows.controller.js';
import { demoWindows } from '../src/demo/demo-windows.js';

describe('PUT /v1/demo/windows (#371, demo mode only)', () => {
  it('reads and switches the windows; null is the legal window again; unknown names are 400', () => {
    const controller = new DemoWindowsController();
    try {
      expect(
        controller.put({ windows: { DEMO_LADDER_NOTICE_WINDOW: 'PT1M' } }).windows,
      ).toMatchObject({ DEMO_LADDER_NOTICE_WINDOW: 60_000, DEMO_LADDER_WARNING_WINDOW: null });
      expect(controller.get().windows.DEMO_LADDER_NOTICE_WINDOW).toBe(60_000);
      expect(() => controller.put({ windows: { DEMO_NOPE: 'PT1M' } })).toThrow();
    } finally {
      controller.put({ windows: { DEMO_LADDER_NOTICE_WINDOW: null } });
    }
    expect(demoWindows.get('DEMO_LADDER_NOTICE_WINDOW')).toBeUndefined();
  });
});
