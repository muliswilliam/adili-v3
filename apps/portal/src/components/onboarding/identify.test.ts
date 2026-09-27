import { describe, expect, it } from 'vitest';

import { IDENTIFY_ERRORS, identifyErrors, identifySchema } from './identify';

const valid = { commission: 'tsc', personnelFileNumber: 'TSC/100200', nationalId: '12345678' };

describe('identifySchema', () => {
  it('accepts file numbers with letters, digits and / - .', () => {
    expect(identifyErrors(valid)).toBeNull();
    expect(identifyErrors({ ...valid, personnelFileNumber: 'A-1.2/3' })).toBeNull();
  });

  it('strips spaces from the national ID before checking 5 to 10 digits', () => {
    expect(identifySchema.parse({ ...valid, nationalId: '1234 5678' }).nationalId).toBe('12345678');
    expect(identifyErrors({ ...valid, nationalId: '1234' })?.nationalId).toBe(
      IDENTIFY_ERRORS.nationalId,
    );
    expect(identifyErrors({ ...valid, nationalId: '12345678901' })?.nationalId).toBe(
      IDENTIFY_ERRORS.nationalId,
    );
    expect(identifyErrors({ ...valid, nationalId: '1234a678' })?.nationalId).toBe(
      IDENTIFY_ERRORS.nationalId,
    );
  });

  it('rejects empty, too long or oddly punctuated file numbers', () => {
    for (const personnelFileNumber of ['', 'x'.repeat(31), 'TSC#1', 'TSC 1']) {
      expect(identifyErrors({ ...valid, personnelFileNumber })?.personnelFileNumber).toBe(
        IDENTIFY_ERRORS.personnelFileNumber,
      );
    }
  });

  it('requires a Commission and reports every field at once', () => {
    expect(identifyErrors({ commission: '', personnelFileNumber: '', nationalId: '' })).toEqual({
      commission: IDENTIFY_ERRORS.commission,
      personnelFileNumber: IDENTIFY_ERRORS.personnelFileNumber,
      nationalId: IDENTIFY_ERRORS.nationalId,
    });
  });
});
