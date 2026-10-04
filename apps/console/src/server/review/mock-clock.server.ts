/**
 * The review mocks' one clock. It is a module of its own because the review mock
 * (`mock.server.ts`) and the copilot mock (`copilot-mock.server.ts`) share it; a mock with a
 * single user, like the portal's review mock, creates its clock inline. `resetReviewMock`
 * starts it at the instant it seeds the cases as of, so a mock seeded as of a fixed time (in
 * tests) answers as of that time, not the wall clock; seeded as of now, it is the wall clock.
 */
import { createMockClock } from '@adili/api-kit/client';

export const reviewClock = createMockClock();
