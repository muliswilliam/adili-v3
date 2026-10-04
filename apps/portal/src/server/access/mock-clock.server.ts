import { createMockClock } from '@adili/api-kit/client';

/**
 * The access mocks' one clock (`mock.server.ts`, `mock-notices.server.ts`,
 * `mock-history.server.ts`). Only `resetAccessMocks` starts it, as it seeds all three.
 */
export const accessClock = createMockClock();
