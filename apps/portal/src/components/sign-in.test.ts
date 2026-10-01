import { describe, expect, it } from 'vitest';

import { stepUpHref } from './sign-in';

describe('stepUpHref', () => {
  it('goes through the BFF step-up route and back to the page with its query', () => {
    expect(stepUpHref('/declarations/d-1/summary?stepUp=done')).toBe(
      '/auth/step-up?returnTo=%2Fdeclarations%2Fd-1%2Fsummary%3FstepUp%3Ddone',
    );
  });
});
