import { describe, expect, it } from 'vitest';

import { refusalOf } from './refusals';

describe('a sign-off refusal', () => {
  it('reads 409 report-preview as a preview, which no sign-off takes (#556)', () => {
    expect(
      refusalOf({
        type: 'report-preview',
        title: 'Report is a preview',
        status: 409,
        code: 'report-preview',
      }),
    ).toBe('preview');
  });
});
