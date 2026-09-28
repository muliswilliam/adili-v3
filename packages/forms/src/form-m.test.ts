import schema from '@adili/schemas/forms/form-m.v1.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

import {
  ACTIONS_TAKEN,
  CLARIFICATION_STATUSES,
  COMPLIANCE_STATUSES,
  DECLINE_REASONS,
  FormMSchema,
  formMIssues,
  REPORT_SOURCES,
  validateFormM,
} from './index.js';
import { completeFormM, invalidFormMs, pathsOf, validFormMs } from './test/fixtures.js';

const defs = schema.$defs;
const partII = schema.properties.partII.properties;

describe('validateFormM', () => {
  it.each(validFormMs())('accepts %s', (_name, document) => {
    expect(validateFormM(document)).toEqual({ ok: true, value: document });
  });

  it.each(invalidFormMs())('rejects %s with the expected paths (S14)', (_name, fixture) => {
    const result = validateFormM(fixture.document);

    expect(result.ok ? [] : pathsOf(result.errors)).toEqual(fixture.errors);
  });
});

describe('formMIssues', () => {
  it.each(validFormMs())('finds nothing in %s', (_name, document) => {
    expect(formMIssues(document)).toEqual({ issues: [], report: [] });
  });

  it.each(invalidFormMs())(
    'places each problem in %s on its Form M section and field (S14)',
    (_name, { issues, document }) => {
      expect(formMIssues(document)).toEqual({ issues, report: [] });
    },
  );

  it('keeps the platform’s own fields out of the Form M sections', () => {
    const document = completeFormM() as unknown as Record<string, unknown>;
    document.meta = { source: 'emailed' };

    expect(formMIssues(document)).toEqual({
      issues: [],
      report: [{ path: 'meta.source', message: 'must be equal to one of the allowed values' }],
    });
  });

  it('places a missing section on the section itself', () => {
    const document = completeFormM();
    delete (document.partII as Partial<typeof document.partII>).clarifications;

    expect(formMIssues(document).issues).toEqual([
      { sectionKey: 'clarifications', path: '', code: 'required', message: 'is required' },
    ]);
  });
});

describe('form-m.v1 enumerations', () => {
  it.each([
    ['ACTIONS_TAKEN', ACTIONS_TAKEN, defs.NonFilerRow.properties.actionTaken.enum],
    ['COMPLIANCE_STATUSES', COMPLIANCE_STATUSES, defs.NonFilerRow.properties.complied.enum],
    [
      'CLARIFICATION_STATUSES',
      CLARIFICATION_STATUSES,
      partII.clarifications.properties.items.items.properties.statusOfCompliance.enum,
    ],
    [
      'DECLINE_REASONS',
      DECLINE_REASONS,
      partII.accessRequests.properties.declineReasons.items.properties.reason.enum,
    ],
    ['REPORT_SOURCES', REPORT_SOURCES, schema.properties.meta.properties.source.enum],
  ])('%s lists the schema’s values in schema order', (_name, values, expected) => {
    expect(values).toEqual(expected);
  });
});

describe('FormMSchema', () => {
  it.each(validFormMs())('accepts %s', (_name, document) => {
    expect(FormMSchema.safeParse(document).error?.issues).toBeUndefined();
  });

  it.each(invalidFormMs())(
    'rejects %s at the field the JSON Schema does',
    (_name, { errors, document }) => {
      const result = FormMSchema.safeParse(document);

      expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(errors);
    },
  );

  it('accepts an unsigned Part III and an unanswered register as null', () => {
    const document = completeFormM();
    document.partIII.confirmedBy = { name: null, designation: null, date: null };
    document.partII.complaints.registerMaintained = null;

    expect(FormMSchema.safeParse(document).success).toBe(true);
  });

  it('keeps the biennial section’s own fields strict', () => {
    const document = completeFormM();
    Object.assign(document.partII.biennial, { cycle: 2027 });

    expect(FormMSchema.safeParse(document).error?.issues.map((issue) => issue.code)).toEqual([
      'unrecognized_keys',
    ]);
  });
});
