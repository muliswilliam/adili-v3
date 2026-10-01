import { describe, expect, it } from 'vitest';

import { resolveCode } from './resolve-code';

const CODE = 'ADL-7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P';

describe('resolveCode', () => {
  it('looks up a code in its printed form', () => {
    expect(resolveCode(CODE)).toEqual({ action: 'look-up', verificationId: CODE });
  });

  it('redirects any other spelling of a code to the printed form', () => {
    expect(resolveCode('adl-7q4k-m2xr-9htc-w3nb-5fjd-k6rt-8p')).toEqual({
      action: 'redirect',
      verificationId: CODE,
    });
    expect(resolveCode('7Q4KM2XR9HTCW3NB5FJDK6RT8P')).toEqual({
      action: 'redirect',
      verificationId: CODE,
    });
  });

  it('shows a code that cannot be one as malformed, cut to a readable length', () => {
    expect(resolveCode('ADL-7Q4U-XX')).toEqual({ action: 'malformed', shown: 'ADL-7Q4U-XX' });
    expect(resolveCode('X'.repeat(200))).toEqual({ action: 'malformed', shown: 'X'.repeat(64) });
  });
});
