/**
 * The clock shared by the review mocks (`mock.server.ts` and the mocks it routes to), hence a
 * module of its own. `resetReviewMock` is the only one to start it, at the instant it seeds the
 * fixtures as of, so a mock seeded as of a fixed time (in tests) answers as of that time, not the
 * wall clock; seeded as of now, it is the wall clock.
 */
import { createMockClock } from '@adili/api-kit/client';

export const reviewClock = createMockClock();
