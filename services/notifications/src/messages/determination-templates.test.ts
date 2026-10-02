import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { renderTemplate, TEMPLATE_IDS, type TemplateId } from './templates.js';

/**
 * Spec 08 templates, with the params the review service sends each (its determination and
 * enforcement activities): every one has an email and an SMS.
 */
const PORTAL = 'https://portal.adili.go.ke';
const PSC = 'Public Service Commission';
const CMP = 'CMP-PSC-2027-0000001-D';
const ADM = 'ADM-PSC-2028-0000233-9';

/** The longest values each template accepts, for the SMS length checks. */
const LONG_COMMISSION = 'C'.repeat(120);
const LONG_CMP = 'CMP-ABCDEFGHIJKLMNOPQRST-2027-9999999-F';
const LONG_ADM = 'ADM-ABCDEFGHIJKLMNOPQRST-2028-9999999-P';

function issuesOf(template: TemplateId, params: unknown): string[] {
  try {
    renderTemplate(template, 'en', params);
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
    return (error as ZodError).issues.map((issue) => issue.path.join('.')).sort();
  }
  return [];
}

const DETERMINATION_TEMPLATES: [string, Record<string, string>][] = [
  [
    'decision',
    {
      commission: PSC,
      reference: CMP,
      outcome: 'Non-compliant',
      portalUrl: `${PORTAL}/decisions/1`,
    },
  ],
  [
    'notice',
    {
      commission: PSC,
      reference: ADM,
      step: 'Notice to comply',
      actBy: '2028-01-19',
      portalUrl: `${PORTAL}/notices/1`,
    },
  ],
  [
    'salary-stopped',
    {
      commission: PSC,
      reference: ADM,
      stoppedFrom: '2028-02-05',
      actBy: '2028-03-05',
      portalUrl: `${PORTAL}/notices/1`,
    },
  ],
  [
    'salary-reinstated',
    {
      commission: PSC,
      reference: ADM,
      reinstatedOn: '2028-02-20',
      portalUrl: `${PORTAL}/notices/1`,
    },
  ],
];

const params = (name: string) => DETERMINATION_TEMPLATES.find(([each]) => each === name)?.[1] ?? {};

describe('determination and enforcement templates (spec 08)', () => {
  it('registers eight templates, an email and an SMS of each', () => {
    const ids = DETERMINATION_TEMPLATES.flatMap(([name]) => [`${name}-email`, `${name}-sms`]);
    expect(ids).toHaveLength(8);
    for (const id of ids) expect(TEMPLATE_IDS).toContain(id);
  });

  it.each(DETERMINATION_TEMPLATES)(
    '%s renders an email linking the portal page and an SMS, with the reference',
    (name, values) => {
      const rendered = renderTemplate(`${name}-email` as TemplateId, 'en', values);
      expect(rendered.subject).toContain(values.reference);
      expect(rendered.text).toContain(`Sign in to Adili Online at ${values.portalUrl}`);
      expect(rendered.html).toContain(`<a href="${values.portalUrl}">`);
      // The reinstatement has no letter: nothing to say is not attached.
      if (name === 'salary-reinstated') expect(rendered.text).not.toContain('not attached');
      else expect(rendered.text).toContain('It is not attached to this email');
      const sms = renderTemplate(`${name}-sms` as TemplateId, 'en', values).text;
      expect(sms).toMatch(/^Adili: /);
      expect(sms).toContain(values.reference);
      expect(sms).toContain(values.portalUrl);
    },
  );

  it.each(DETERMINATION_TEMPLATES)('%s rejects unexpected and missing params', (name, values) => {
    for (const channel of ['email', 'sms']) {
      const template = `${name}-${channel}` as TemplateId;
      expect(issuesOf(template, { ...values, declarantName: 'Grace' })).toEqual(['params']);
      expect(issuesOf(template, {})).toEqual(
        Object.keys(values)
          .map((key) => `params.${key}`)
          .sort(),
      );
    }
  });

  it.each(DETERMINATION_TEMPLATES)(
    '%s escapes the Commission name in the HTML body',
    (name, values) => {
      const rendered = renderTemplate(`${name}-email` as TemplateId, 'en', {
        ...values,
        commission: 'Teachers <Service> & Co',
      });
      expect(rendered.html).toContain('Teachers &lt;Service&gt; &amp; Co');
      expect(rendered.html).not.toContain('<Service>');
    },
  );

  it.each(DETERMINATION_TEMPLATES)(
    '%s refuses an http portal link where links must be https',
    (name, values) => {
      const http = { ...values, portalUrl: 'http://portal.adili.go.ke/notices/1' };
      expect(() =>
        renderTemplate(`${name}-sms` as TemplateId, 'en', http, { httpsLinksOnly: true }),
      ).toThrow('must be an https URL');
    },
  );

  it('tells the declarant of a non-compliant decision that administrative action may follow', () => {
    const rendered = renderTemplate('decision-email', 'en', params('decision'));
    expect(rendered.subject).toBe(`Decision on your declaration: ${CMP}`);
    expect(rendered.text).toContain(
      `${PSC} has made its compliance determination on your declaration. The outcome is Non-compliant. Its reference number is ${CMP}.`,
    );
    expect(rendered.text).toContain(
      'Your Commission may take administrative action. Check Notices',
    );
    expect(renderTemplate('decision-sms', 'en', params('decision')).text).toBe(
      `Adili: ${PSC} has decided on your declaration (${CMP}). The outcome is Non-compliant. Read it at ${PORTAL}/decisions/1`,
    );
  });

  it.each(['Compliant', 'Compliant: no issues identified', 'Further action'])(
    'tells the declarant of a %s decision without warning of administrative action',
    (outcome) => {
      const rendered = renderTemplate('decision-email', 'en', { ...params('decision'), outcome });
      expect(rendered.text).toContain(`The outcome is ${outcome}.`);
      expect(rendered.text).not.toContain('administrative action');
    },
  );

  it("refuses an outcome or a reference that is not a determination's", () => {
    expect(issuesOf('decision-sms', { ...params('decision'), outcome: 'non-compliant' })).toEqual([
      'params.outcome',
    ]);
    expect(issuesOf('decision-sms', { ...params('decision'), reference: ADM })).toEqual([
      'params.reference',
    ]);
    expect(
      issuesOf('decision-sms', { ...params('decision'), reference: 'CMP-PSC-2027-0000001-A' }),
    ).toEqual(['params.reference']);
  });

  it('tells the declarant of a notice to comply or a warning, and by when to act', () => {
    const rendered = renderTemplate('notice-email', 'en', params('notice'));
    expect(rendered.subject).toBe(`Notice to comply ${ADM}`);
    expect(rendered.text).toContain(`${PSC} has issued you a notice to comply, reference ${ADM}.`);
    expect(rendered.text).toContain('Act by 19 January 2028.');
    expect(renderTemplate('notice-sms', 'en', params('notice')).text).toBe(
      `Adili: ${PSC} has issued you a notice to comply (${ADM}). Act by 19 January 2028. Read it and respond at ${PORTAL}/notices/1`,
    );
    const warning = renderTemplate('notice-email', 'en', { ...params('notice'), step: 'Warning' });
    expect(warning.subject).toBe(`Warning ${ADM}`);
    expect(warning.text).toContain('has issued you a warning, reference');
  });

  it("refuses a step that is not a notice's: the stoppage and the referral have their own", () => {
    for (const step of ['Salary stoppage', 'Disciplinary referral', 'notice-to-comply']) {
      expect(issuesOf('notice-sms', { ...params('notice'), step })).toEqual(['params.step']);
    }
    expect(issuesOf('notice-sms', { ...params('notice'), reference: CMP })).toEqual([
      'params.reference',
    ]);
  });

  it('tells the declarant their salary is stopped, from when, and that compliance reinstates it', () => {
    const rendered = renderTemplate('salary-stopped-email', 'en', params('salary-stopped'));
    expect(rendered.subject).toBe(`Your salary has been stopped: ${ADM}`);
    expect(rendered.text).toContain(
      `${PSC} has instructed payroll to stop your salary from 5 February 2028, pending compliance (reference ${ADM}). It will be reinstated automatically when you comply.`,
    );
    expect(rendered.text).toContain('If you have not complied by 5 March 2028');
    expect(renderTemplate('salary-stopped-sms', 'en', params('salary-stopped')).text).toBe(
      `Adili: ${PSC} has stopped your salary from 5 February 2028 pending compliance (${ADM}). It is reinstated when you comply. Details at ${PORTAL}/notices/1`,
    );
  });

  it('tells the declarant the reinstatement was sent to payroll, and when', () => {
    const rendered = renderTemplate('salary-reinstated-email', 'en', params('salary-reinstated'));
    expect(rendered.subject).toBe(`Your salary has been reinstated: ${ADM}`);
    expect(rendered.text).toContain(
      `${PSC} sent your salary reinstatement to payroll on 20 February 2028. It ends the salary stoppage ${ADM}.`,
    );
    expect(renderTemplate('salary-reinstated-sms', 'en', params('salary-reinstated')).text).toBe(
      `Adili: ${PSC} sent your salary reinstatement to payroll on 20 February 2028 (stoppage ${ADM}). Details at ${PORTAL}/notices/1`,
    );
  });

  it('refuses dates that are not civil dates', () => {
    expect(
      issuesOf('salary-stopped-sms', {
        ...params('salary-stopped'),
        stoppedFrom: '2028-02-05T00:00:00Z',
      }),
    ).toEqual(['params.stoppedFrom']);
    expect(issuesOf('notice-sms', { ...params('notice'), actBy: '19 Jan 2028' })).toEqual([
      'params.actBy',
    ]);
  });

  it('keeps each SMS to two GSM segments with the longest values but the portal link', () => {
    const longest: Record<string, Record<string, string>> = {
      decision: { reference: LONG_CMP, outcome: 'Compliant: no issues identified' },
      notice: { reference: LONG_ADM, step: 'Notice to comply', actBy: '2028-09-30' },
      'salary-stopped': { reference: LONG_ADM, stoppedFrom: '2028-09-30', actBy: '2028-09-30' },
      'salary-reinstated': { reference: LONG_ADM, reinstatedOn: '2028-09-30' },
    };
    for (const [name, values] of DETERMINATION_TEMPLATES) {
      const { text } = renderTemplate(`${name}-sms` as TemplateId, 'en', {
        ...values,
        ...longest[name],
        commission: LONG_COMMISSION,
      });
      // Two concatenated GSM-7 segments carry 153 characters each; plain ASCII stays GSM-7.
      expect(text.replace(values.portalUrl ?? '', '').length, name).toBeLessThanOrEqual(306);
      expect(text).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});
