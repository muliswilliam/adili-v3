import { describe, expect, it } from 'vitest';

import { contractEnum } from '../test/contract';
import {
  ASSET_TYPES,
  CHANGE_KINDS,
  EMPLOYMENT_NATURES,
  INCOME_TYPES,
  LIABILITY_TYPES,
  MARITAL_STATUSES,
  MEMBERSHIP_KINDS,
  OCCUPATION_SECTORS,
} from './contents';
import {
  ASSET_TYPE_LABELS,
  CHANGE_KIND_WORDS,
  COMPLETENESS_LABELS,
  EMPLOYMENT_NATURE_LABELS,
  INCOME_TYPE_LABELS,
  LIABILITY_TYPE_LABELS,
  MARITAL_STATUS_LABELS,
  MEMBERSHIP_KIND_LABELS,
  OBLIGATION_TYPE_LABELS,
  OCCUPATION_SECTOR_LABELS,
  optionsOf,
} from './labels';

describe('enum labels', () => {
  it.each([
    [MARITAL_STATUS_LABELS, MARITAL_STATUSES],
    [EMPLOYMENT_NATURE_LABELS, EMPLOYMENT_NATURES],
    [OCCUPATION_SECTOR_LABELS, OCCUPATION_SECTORS],
    [INCOME_TYPE_LABELS, INCOME_TYPES],
    [ASSET_TYPE_LABELS, ASSET_TYPES],
    [LIABILITY_TYPE_LABELS, LIABILITY_TYPES],
    [CHANGE_KIND_WORDS, CHANGE_KINDS],
    [MEMBERSHIP_KIND_LABELS, MEMBERSHIP_KINDS],
  ] as [Record<string, string>, readonly string[]][])(
    'labels every value in schema order',
    (labels, values) => {
      expect(Object.keys(labels)).toEqual([...values]);
    },
  );

  it('labels every obligation type and completeness in the contract', () => {
    expect(Object.keys(OBLIGATION_TYPE_LABELS)).toEqual(
      contractEnum('ObligationType', 'declarations.yaml'),
    );
    expect(Object.keys(COMPLETENESS_LABELS).sort()).toEqual(
      contractEnum('Completeness', 'declarations.yaml').sort(),
    );
  });

  it('builds options in order', () => {
    expect(optionsOf(MARITAL_STATUS_LABELS)[0]).toEqual({ value: 'single', label: 'Single' });
  });
});
