import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { renderTemplate, TEMPLATE_IDS, templateChannel, type TemplateId } from './templates.js';

/**
 * Spec 09 Form M templates, with the params the reporting service sends each (its compliance
 * report activities and EACC's national consolidation chase): emails to a Commission's staff.
 */
const RPT = 'RPT-PSC-2028-0000001-O';

const FORM_M_TEMPLATES: [TemplateId, Record<string, string | number>][] = [
  ['form-m-draft-ready-email', { financialYear: '2027/2028', dueDate: '2028-07-31' }],
  ['form-m-reminder-email', { financialYear: '2027/2028', dueDate: '2028-07-31', daysLeft: 7 }],
  [
    'form-m-receipt-email',
    { financialYear: '2027/2028', reference: RPT, submittedOn: '2028-07-15', late: 'no' },
  ],
  ['form-m-chase-email', { financialYear: '2027/2028', dueDate: '2028-07-31', round: 2 }],
];

const params = (id: TemplateId) => FORM_M_TEMPLATES.find(([each]) => each === id)?.[1] ?? {};

function issuesOf(template: TemplateId, values: unknown): string[] {
  try {
    renderTemplate(template, 'en', values);
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
    return (error as ZodError).issues.map((issue) => issue.path.join('.')).sort();
  }
  return [];
}

describe('Form M templates (spec 09)', () => {
  it('registers the four, each an email', () => {
    for (const [id] of FORM_M_TEMPLATES) {
      expect(TEMPLATE_IDS).toContain(id);
      expect(templateChannel(id)).toBe('email');
    }
  });

  it.each(FORM_M_TEMPLATES)(
    '%s renders with the year, points to the console and attaches nothing',
    (id, values) => {
      const rendered = renderTemplate(id, 'en', values);
      expect(rendered.subject).toContain('Form M');
      expect(rendered.text).toContain('the financial year 2027/2028');
      expect(rendered.text).toContain('Open Form M in the Adili Online console');
      expect(rendered.html).toContain('<p>');
    },
  );

  it.each(FORM_M_TEMPLATES)('%s rejects unexpected and missing params', (id, values) => {
    expect(issuesOf(id, { ...values, commissionName: 'PSC' })).toEqual(['params']);
    expect(issuesOf(id, {})).toEqual(
      Object.keys(values)
        .map((key) => `params.${key}`)
        .sort(),
    );
  });

  it('tells the officers the draft is ready to review, and by when it is due', () => {
    const rendered = renderTemplate(
      'form-m-draft-ready-email',
      'en',
      params('form-m-draft-ready-email'),
    );
    expect(rendered.subject).toBe('Form M for 2027/2028 is ready to review');
    expect(rendered.text).toContain(
      "Your Commission's Form M compliance report for the financial year 2027/2028 has been compiled from its roster, filings, clarifications and administrative actions, and is ready to review.",
    );
    expect(rendered.text).toContain('It is due with EACC by 31 July 2028.');
    expect(rendered.text).toContain('The report is not attached to this email');
  });

  it.each([
    [14, 'in 14 days'],
    [7, 'in 7 days'],
    [1, 'tomorrow'],
    [0, 'today'],
  ])('reminds the officers %s days before the deadline', (daysLeft, when) => {
    const rendered = renderTemplate('form-m-reminder-email', 'en', {
      ...params('form-m-reminder-email'),
      daysLeft,
    });
    expect(rendered.subject).toBe(`Reminder: Form M for 2027/2028 is due ${when}`);
    expect(rendered.text).toContain(`It is due on 31 July 2028, ${when}.`);
    expect(rendered.text).toContain('still accepted and recorded as late');
  });

  it('tells the officers the report was submitted, with its reference, and whether late', () => {
    const onTime = renderTemplate('form-m-receipt-email', 'en', params('form-m-receipt-email'));
    expect(onTime.subject).toBe(`Form M ${RPT} submitted to EACC`);
    expect(onTime.text).toContain(
      `was submitted to EACC on 15 July 2028. Its reference number is ${RPT}.`,
    );
    expect(onTime.text).toContain("EACC's acknowledgement of receipt");
    expect(onTime.text).toContain('They are not attached to this email.');
    expect(onTime.text).not.toContain('late');
    const late = renderTemplate('form-m-receipt-email', 'en', {
      ...params('form-m-receipt-email'),
      submittedOn: '2028-08-05',
      late: 'yes',
    });
    expect(late.text).toContain(
      'EACC received it after the 31 July deadline, so it is recorded as late.',
    );
  });

  it("chases a report EACC has not received, saying which week's reminder it is", () => {
    const rendered = renderTemplate('form-m-chase-email', 'en', params('form-m-chase-email'));
    expect(rendered.subject).toBe('Overdue: Form M for 2027/2028');
    expect(rendered.text).toContain(
      "EACC has not received your Commission's Form M compliance report for the financial year 2027/2028, which was due on 31 July 2028.",
    );
    expect(rendered.text).toContain("This is EACC's reminder number 2.");
  });

  it('refuses a year, a due date, a reference or a flag that are not what the reporting service sends', () => {
    expect(
      issuesOf('form-m-draft-ready-email', { financialYear: '2027', dueDate: '2028-07-31' }),
    ).toEqual(['params.financialYear']);
    expect(
      issuesOf('form-m-draft-ready-email', { financialYear: '2027/2029', dueDate: '2028-07-31' }),
    ).toEqual(['params.financialYear']);
    // The deadline is 31 July after the year; a malformed year reports once, on itself.
    expect(
      issuesOf('form-m-chase-email', { ...params('form-m-chase-email'), dueDate: '2027-07-31' }),
    ).toEqual(['params.dueDate']);
    expect(
      issuesOf('form-m-reminder-email', { ...params('form-m-reminder-email'), daysLeft: 1.5 }),
    ).toEqual(['params.daysLeft']);
    expect(
      issuesOf('form-m-receipt-email', {
        ...params('form-m-receipt-email'),
        reference: 'CMP-PSC-2027-0000001-D',
      }),
    ).toEqual(['params.reference']);
    expect(
      issuesOf('form-m-receipt-email', {
        ...params('form-m-receipt-email'),
        reference: 'RPT-PSC-2028-0000001-P',
      }),
    ).toEqual(['params.reference']);
    expect(
      issuesOf('form-m-receipt-email', { ...params('form-m-receipt-email'), late: false }),
    ).toEqual(['params.late']);
    expect(issuesOf('form-m-chase-email', { ...params('form-m-chase-email'), round: 0 })).toEqual([
      'params.round',
    ]);
  });
});
