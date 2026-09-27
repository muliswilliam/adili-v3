import { describe, expect, it } from 'vitest';

import { ProblemException, toProblemDetails } from '../src/problem-details.filter.js';

describe('toProblemDetails', () => {
  it('renders the extension members of a problem next to the standard ones (RFC 9457 §3.2)', () => {
    const exception = new ProblemException(
      {
        type: 'import-in-progress',
        title: 'Import in progress',
        status: 409,
        detail: 'Another import is still running.',
      },
      { importId: '0199a1b2-0000-7000-8000-000000000001' },
    );

    expect(toProblemDetails(exception, '/v1/imports')).toEqual({
      type: 'import-in-progress',
      title: 'Import in progress',
      status: 409,
      detail: 'Another import is still running.',
      importId: '0199a1b2-0000-7000-8000-000000000001',
      instance: '/v1/imports',
    });
  });

  it('keeps the standard members when an extension names one of them', () => {
    const exception = new ProblemException(
      { type: 'conflict', title: 'Conflict', status: 409 },
      { status: 200, type: 'other' },
    );

    expect(toProblemDetails(exception, '/x')).toMatchObject({ type: 'conflict', status: 409 });
  });
});
