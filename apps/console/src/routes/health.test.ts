import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/env.server', () => ({
  envSchema: {
    shape: { APP_URL: {}, REVIEW_MOCK: {}, ACCESS_MOCK: {}, REVIEW_MOCK_COPILOT: {} },
  },
  env: () => ({
    APP_URL: 'http://localhost:3020',
    REVIEW_MOCK: true,
    ACCESS_MOCK: false,
    REVIEW_MOCK_COPILOT: 'ready',
  }),
}));

const { mocksOn } = await import('./health');

describe('the health route', () => {
  it('names the mocks that are on, and only the on/off mock settings', () => {
    expect(mocksOn()).toEqual(['REVIEW_MOCK']);
  });
});
