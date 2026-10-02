import { describe, expect, it } from 'vitest';

import { createRowValidator, parseDate } from '../../src/roster/row-validation.js';

const base = { personnelFileNumber: 'A1', fullName: 'Jane Doe', nationalId: '12345678' };

describe('createRowValidator', () => {
  it('normalises phone numbers to E.164 with Kenya as the default region', () => {
    const cases = {
      '0712345678': '+254712345678',
      '712 345 678': '+254712345678',
      '254712345678': '+254712345678',
      '+254 (0)712-345-678': '+254712345678',
      '0110 123 456': '+254110123456',
      '+44 20 7946 0958': '+442079460958',
    };
    for (const [input, expected] of Object.entries(cases)) {
      const result = createRowValidator()({ ...base, phone: input }, 2);
      expect(result.normalised?.phone, input).toBe(expected);
    }
  });

  it('accepts null and blank optional fields (API batches send null)', () => {
    const result = createRowValidator()(
      {
        ...base,
        designation: null,
        email: '   ',
        phone: null,
        appointmentDate: '',
        workStation: null,
        maritalStatus: ' ',
      },
      2,
    );

    expect(result).toMatchObject({
      status: 'accepted',
      normalised: {
        designation: null,
        email: null,
        phone: null,
        appointmentDate: null,
        workStation: null,
        maritalStatus: null,
      },
    });
  });

  it("reads marital status as declaration.v1's values, ignoring case, and rejects others", () => {
    const validate = createRowValidator();
    const cases = {
      single: 'single',
      ' Married ': 'married',
      SEPARATED: 'separated',
      Divorced: 'divorced',
      widowed: 'widowed',
    };
    let row = 2;
    for (const [input, expected] of Object.entries(cases)) {
      const result = validate(
        {
          personnelFileNumber: `M${row}`,
          fullName: 'Jane Doe',
          nationalId: `1000000${row}`,
          maritalStatus: input,
        },
        row,
      );
      expect(result.normalised?.maritalStatus, input).toBe(expected);
      row += 1;
    }

    expect(validate({ ...base, maritalStatus: 'engaged' }, row).errors).toEqual([
      {
        field: 'maritalStatus',
        code: 'format',
        message: 'Use single, married, separated, divorced or widowed',
      },
    ]);
  });

  it('keeps the work station as written, up to 100 characters', () => {
    const validate = createRowValidator();

    expect(
      validate({ ...base, workStation: '  Afya   House, Nairobi ' }, 2).normalised?.workStation,
    ).toBe('Afya House, Nairobi');
    expect(
      validate(
        {
          ...base,
          personnelFileNumber: 'A2',
          nationalId: '22222222',
          workStation: 'x'.repeat(101),
        },
        3,
      ).errors,
    ).toEqual([{ field: 'workStation', code: 'too-long', message: 'Enter up to 100 characters' }]);
  });

  it('accepts an appointment date of today and rejects tomorrow', () => {
    const validate = createRowValidator({ today: '2026-09-28' });

    expect(validate({ ...base, appointmentDate: '28/09/2026' }, 2).status).toBe('accepted');
    expect(
      validate(
        {
          ...base,
          personnelFileNumber: 'A2',
          nationalId: '22222222',
          appointmentDate: '29-09-2026',
        },
        3,
      ).errors,
    ).toEqual([
      { field: 'appointmentDate', code: 'future-date', message: 'Date is in the future' },
    ]);
  });

  it('compares file numbers case-insensitively for duplicates, keeping them as written', () => {
    const validate = createRowValidator();

    expect(
      validate({ ...base, personnelFileNumber: 'Tsc/1' }, 2).normalised?.personnelFileNumber,
    ).toBe('Tsc/1');
    expect(
      validate({ ...base, personnelFileNumber: 'TSC/1', nationalId: '99999999' }, 3).errors,
    ).toEqual([
      expect.objectContaining({ field: 'personnelFileNumber', code: 'duplicate-in-file' }),
    ]);
  });

  it('lets only accepted rows claim their keys, so a corrected re-entry is accepted', () => {
    const validate = createRowValidator();

    // Rejected for its name: neither its file number nor its national ID is imported.
    expect(validate({ ...base, fullName: 'J' }, 2).status).toBe('rejected');
    expect(validate(base, 3)).toMatchObject({ status: 'accepted', errors: [] });
    // Rejected as a duplicate of row 3: its new national ID is not claimed either.
    expect(validate({ ...base, nationalId: '87654321' }, 4).errors).toEqual([
      {
        field: 'personnelFileNumber',
        code: 'duplicate-in-file',
        message: 'Same file number as row 3',
      },
    ]);
    expect(validate({ ...base, personnelFileNumber: 'A2', nationalId: '87654321' }, 5).status).toBe(
      'accepted',
    );
  });

  it('does not let a malformed value claim a key', () => {
    const validate = createRowValidator();

    expect(validate({ ...base, nationalId: '12 34' }, 2).status).toBe('rejected');
    expect(validate({ ...base, personnelFileNumber: 'A2', nationalId: '1234' }, 3).errors).toEqual([
      expect.objectContaining({ field: 'nationalId', code: 'format' }),
    ]);
  });
});

describe('parseDate', () => {
  it('reads ISO and day-first dates and rejects impossible or ambiguous ones', () => {
    expect(parseDate('2019-01-07')).toBe('2019-01-07');
    expect(parseDate('7/1/2019')).toBe('2019-01-07');
    expect(parseDate('07-01-2019')).toBe('2019-01-07');
    expect(parseDate('29/02/2020')).toBe('2020-02-29');
    expect(parseDate('29/02/2019')).toBeNull();
    expect(parseDate('07/01-2019')).toBeNull();
    expect(parseDate('2019-1-7')).toBeNull();
    expect(parseDate('07/01/19')).toBeNull();
    expect(parseDate('01/13/2019')).toBeNull();
  });
});
