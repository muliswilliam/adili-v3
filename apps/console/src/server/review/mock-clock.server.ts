/**
 * The review mocks' one clock (`mock.server.ts`, `copilot-mock.server.ts`). `resetReviewMock`
 * starts it at the instant it seeds the cases as of, so a mock seeded as of a fixed time (in
 * tests) answers as of that time, not the wall clock; seeded as of now, it is the wall clock.
 */
import { createMockClock } from '@adili/api-kit/client';

export const reviewClock = createMockClock();
