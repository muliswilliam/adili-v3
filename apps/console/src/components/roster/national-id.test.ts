import { describe, expect, it } from 'vitest';

import { maskedNationalIdLabel, maskNationalId } from './national-id';

describe('maskNationalId', () => {
  it('hides all but the last three digits', () => {
    expect(maskNationalId('27481123')).toBe('•••••123');
  });

  it('leaves an already masked ID as it is', () => {
    expect(maskNationalId('•••••123')).toBe('•••••123');
  });

  it('masks whatever else a masked value carries beyond the last three', () => {
    expect(maskNationalId('****4123')).toBe('•••••123');
  });

  it('keeps the length, so short and long IDs look different', () => {
    expect(maskNationalId('1234567890')).toBe('•••••••890');
    expect(maskNationalId('123456')).toBe('•••456');
  });

  it('shows an ID of three digits or fewer as it is', () => {
    expect(maskNationalId('123')).toBe('123');
    expect(maskNationalId('')).toBe('');
  });

  it('ignores surrounding spaces', () => {
    expect(maskNationalId(' 27481123 ')).toBe('•••••123');
  });
});

describe('maskedNationalIdLabel', () => {
  it('reads the visible digits one by one', () => {
    expect(maskedNationalIdLabel('•••••123')).toBe('masked, ends in 1 2 3');
  });

  it('never reads more than the last three digits', () => {
    expect(maskedNationalIdLabel('27481123')).toBe('masked, ends in 1 2 3');
  });

  it('says only masked when nothing is visible', () => {
    expect(maskedNationalIdLabel('')).toBe('masked');
  });
});
