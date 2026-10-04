/**
 * The portal review mocks' one clock, shared by `mock.server.ts` and `notices-mock.server.ts`.
 * `resetReviewMock` starts it at the instant it seeds the fixtures as of, so a mock seeded as of a
 * fixed time (in tests) answers as of that time, not the wall clock; seeded as of now, it is the
 * wall clock.
 */
import { createMockClock } from '@adili/api-kit/client';

export const reviewClock = createMockClock();
