import { describe, expect, it, vi } from 'vitest';

vi.mock('./env.server', () => ({
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

const { mocksOn } = await import('./mocks-on.server');

describe('mocksOn', () => {
  it('names the mocks that are on, and only the on/off mock settings', () => {
    expect(mocksOn()).toEqual(['REVIEW_MOCK']);
  });
});
