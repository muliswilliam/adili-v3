import { describe, expect, it } from 'vitest';

import { LINKED_PURPOSES, policyOf, purposesFor } from '../../src/uploads/purposes.js';

describe('upload purposes', () => {
  it('lets a declarant attach evidence to their access-request representations, as their own uploads the access service links', () => {
    expect(purposesFor(['declarant'])).toContain('access-representation');
    expect(policyOf('access-representation')).toMatchObject({
      contentTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'],
      maxSize: 20 * 1024 * 1024,
      uploaderOnly: true,
      linked: true,
    });
    expect(LINKED_PURPOSES).toContain('access-representation');
    expect(purposesFor(['applicant', 'supervisor'])).not.toContain('access-representation');
  });

  it("lets the access officer upload a representative's authority and ID for a written self-access application (#303)", () => {
    expect(purposesFor(['access-officer'])).toContain('access-representation');
  });
});
