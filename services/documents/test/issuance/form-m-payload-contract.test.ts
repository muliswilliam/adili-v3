import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { FormMV1 } from '@adili/forms';
import { format, RPT } from '@adili/numbering/references';
import { describe, expect, it } from 'vitest';

import { componentSchema, contractErrors } from '../support/contract.js';

const fixtures = createRequire(import.meta.url);

/** A valid form-m.v1 fixture as reporting sends it: `meta` with the RPT reference. */
function submitted(name: string): FormMV1 {
  const path = fixtures.resolve(`@adili/schemas/forms/fixtures/form-m.v1/valid/${name}.json`);
  const document = JSON.parse(readFileSync(path, 'utf8')) as FormMV1;
  const issuer = document.partI.issuerCode;
  const period = document.partI.period.financialYearStart + 1;
  document.meta = {
    ...document.meta,
    reference: format(RPT, { issuer, period, sequence: 1 }),
    source: 'hosted',
  };
  return document;
}

describe('the contract of the form-m payload (documents.yaml FormMPayload)', () => {
  it.each(['complete-fy-2027', 'draft-even-fy-2026'])('accepts %s as submitted', (name) => {
    expect(contractErrors(componentSchema('FormMPayload'), submitted(name))).toEqual([]);
  });
});
