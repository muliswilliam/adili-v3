import { describe, expect, it } from 'vitest';

import { errorType } from '../src/error-type.js';

describe('errorType', () => {
  it('names the error and its code, never its message', () => {
    const error = Object.assign(new Error('could not reach +254712345678'), {
      code: 'ECONNREFUSED',
    });

    expect(errorType(error)).toBe('Error:ECONNREFUSED');
    expect(errorType(new TypeError('id 23456789 is bad'))).toBe('TypeError');
  });

  it('describes a thrown non-error by its type', () => {
    expect(errorType('oops')).toBe('string');
  });
});
