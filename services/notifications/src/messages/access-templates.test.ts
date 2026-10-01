import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { renderTemplate, type TemplateId } from './templates.js';

const PORTAL = 'https://portal.adili.go.ke';
const CONSOLE = 'https://console.adili.go.ke';
const PSC = 'Public Service Commission';
const ARQ = 'ARQ-PSC-2026-0000012-5';
const LEA = 'LEA-PSC-2026-0000004-M';

/** The longest values each template accepts, for the one-segment SMS checks. */
const LONG_COMMISSION = 'C'.repeat(120);
const LONG_ARQ = 'ARQ-ABCDEFGHIJKLMNOPQRST-2026-9999999-Z';
const LONG_LEA = 'LEA-ABCDEFGHIJKLMNOPQRST-2026-9999999-Z';

function issuesOf(template: TemplateId, params: unknown): string[] {
  try {
    renderTemplate(template, 'en', params);
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
    return (error as ZodError).issues.map((issue) => issue.path.join('.')).sort();
  }
  return [];
}

/** Spec 10 templates, with valid params each; every one has an email and an SMS. */
const ACCESS_TEMPLATES: [string, Record<string, unknown>][] = [
  [
    'access-acknowledgement',
    {
      reference: ARQ,
      commissionName: PSC,
      decideBy: '2026-10-31',
      identityStatus: 'verified',
      signInUrl: PORTAL,
    },
  ],
  [
    'access-request-notified',
    { reference: ARQ, commissionName: PSC, respondBy: '2026-10-08', signInUrl: PORTAL },
  ],
  [
    'access-decision-applicant',
    { reference: ARQ, commissionName: PSC, outcome: 'granted', signInUrl: PORTAL },
  ],
  [
    'access-decision-declarant',
    { reference: ARQ, commissionName: PSC, outcome: 'denied', signInUrl: PORTAL },
  ],
  [
    'access-package-ready',
    { reference: ARQ, commissionName: PSC, downloadUntil: '2026-10-15', signInUrl: PORTAL },
  ],
  [
    'access-officer-reminder',
    {
      reference: ARQ,
      commissionName: PSC,
      task: 'decide',
      dueDate: '2026-10-31',
      daysLeft: 10,
      signInUrl: CONSOLE,
    },
  ],
  [
    'lea-grant-notice',
    {
      reference: LEA,
      commissionName: PSC,
      agencyName: 'Directorate of Criminal Investigations',
      grantedOn: '2026-10-01',
      signInUrl: PORTAL,
    },
  ],
  ['lea-decision', { reference: LEA, commissionName: PSC, outcome: 'denied', signInUrl: CONSOLE }],
  [
    'certified-copy-ready',
    {
      reference: 'DCB-PSC-2027-0000001-1',
      version: 1,
      commissionName: PSC,
      verificationCode: 'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K',
      signInUrl: PORTAL,
    },
  ],
];

describe('access templates', () => {
  it.each(ACCESS_TEMPLATES)(
    '%s renders an email linking the sign-in page and an SMS',
    (name, params) => {
      const rendered = renderTemplate(`${name}-email` as TemplateId, 'en', params);
      expect(rendered.subject).toBeTruthy();
      expect(rendered.text).toContain(`Sign in to Adili Online at ${String(params.signInUrl)}`);
      expect(rendered.html).toContain(`<a href="${String(params.signInUrl)}">`);
      expect(rendered.text).toContain(String(params.reference));
      expect(renderTemplate(`${name}-sms` as TemplateId, 'en', params).text).toMatch(/^Adili: /);
    },
  );

  it.each(ACCESS_TEMPLATES)('%s rejects unexpected and missing params', (name, params) => {
    for (const channel of ['email', 'sms']) {
      const template = `${name}-${channel}` as TemplateId;
      expect(issuesOf(template, { ...params, applicantName: 'Amina' })).toEqual(['params']);
      expect(issuesOf(template, {})).toEqual(
        Object.keys(params)
          .map((key) => `params.${key}`)
          .sort(),
      );
    }
  });

  it.each(ACCESS_TEMPLATES)('%s escapes the Commission name in the HTML body', (name, params) => {
    const rendered = renderTemplate(`${name}-email` as TemplateId, 'en', {
      ...params,
      commissionName: 'Teachers <Service> & Co',
    });
    expect(rendered.html).toContain('Teachers &lt;Service&gt; &amp; Co');
    expect(rendered.html).not.toContain('<Service>');
  });

  it('acknowledges Form K to the applicant with its reference and decision deadline', () => {
    const params = ACCESS_TEMPLATES[0]?.[1];
    const rendered = renderTemplate('access-acknowledgement-email', 'en', params);
    expect(rendered.subject).toBe(`Request ${ARQ} received`);
    expect(rendered.text).toContain(`${PSC} has received your request ${ARQ} to see a declaration`);
    expect(rendered.text).toContain('The Commission must decide by 31 October 2026.');
    expect(rendered.text).not.toContain('passport');
    expect(renderTemplate('access-acknowledgement-sms', 'en', params).text).toBe(
      `Adili: your request ${ARQ} was received. Decision due by 31 October 2026. Follow it at ${PORTAL}`,
    );
  });

  it('tells a passport applicant their particulars are checked before the request goes ahead', () => {
    const rendered = renderTemplate('access-acknowledgement-email', 'en', {
      ...ACCESS_TEMPLATES[0]?.[1],
      identityStatus: 'pending-verification',
    });
    expect(rendered.text).toContain(
      'You registered with a passport, so the Commission will first check the particulars you entered.',
    );
    expect(
      issuesOf('access-acknowledgement-email', {
        ...ACCESS_TEMPLATES[0]?.[1],
        identityStatus: 'unknown',
      }),
    ).toEqual(['params.identityStatus']);
  });

  it('tells the declarant of a request before any decision, with the window, and nothing of who asked', () => {
    const rendered = renderTemplate(
      'access-request-notified-email',
      'en',
      ACCESS_TEMPLATES[1]?.[1],
    );
    expect(rendered.subject).toBe('Someone has asked to see your declaration');
    expect(rendered.text).toContain(`A request (${ARQ}) has been made to ${PSC}`);
    expect(rendered.text).toContain('You may object, consent or add context until 8 October 2026.');
    expect(rendered.text).toContain('to see who asked, why and what they asked to see');
    expect(renderTemplate('access-request-notified-sms', 'en', ACCESS_TEMPLATES[1]?.[1]).text).toBe(
      `Adili: request ${ARQ} asks to see your declaration. Respond by 8 October 2026 at ${PORTAL}`,
    );
  });

  it.each([
    ['granted', 'has been granted.', `Request ${ARQ} granted`],
    ['partially-granted', 'has been partly granted', `Request ${ARQ} partly granted`],
    ['denied', 'You may seek relief from the court.', `Request ${ARQ} refused`],
    ['cannot-identify', 'could not identify the officer you named', `Request ${ARQ} closed`],
  ])('tells the applicant a request was %s', (outcome, sentence, subject) => {
    const params = { reference: ARQ, commissionName: PSC, outcome, signInUrl: PORTAL };
    const rendered = renderTemplate('access-decision-applicant-email', 'en', params);
    expect(rendered.subject).toBe(subject);
    expect(rendered.text).toContain(sentence);
  });

  it('does not offer the declarant a decision they cannot get: cannot-identify never reaches them', () => {
    expect(
      issuesOf('access-decision-declarant-email', {
        ...ACCESS_TEMPLATES[3]?.[1],
        outcome: 'cannot-identify',
      }),
    ).toEqual(['params.outcome']);
  });

  it('reminds the recipient of a package of its window and of the republication offence', () => {
    const rendered = renderTemplate('access-package-ready-email', 'en', ACCESS_TEMPLATES[4]?.[1]);
    expect(rendered.text).toContain('You can download it until 15 October 2026');
    expect(rendered.text).toContain('section 36(4) of the Conflict of Interest Act');
    expect(rendered.text).toContain('It is not attached to this email');
  });

  it('accepts a law-enforcement package and reminder, refuses another reference scheme', () => {
    const ready = ACCESS_TEMPLATES[4]?.[1];
    expect(issuesOf('access-package-ready-sms', { ...ready, reference: LEA })).toEqual([]);
    expect(
      issuesOf('access-package-ready-sms', { ...ready, reference: 'DCB-PSC-2027-0000001-1' }),
    ).toEqual(['params.reference']);
    expect(issuesOf('lea-decision-sms', { ...ACCESS_TEMPLATES[7]?.[1], reference: ARQ })).toEqual([
      'params.reference',
    ]);
  });

  it('reminds the access officer to identify the officer, or to decide by the deadline', () => {
    const params = ACCESS_TEMPLATES[5]?.[1];
    const identify = renderTemplate('access-officer-reminder-email', 'en', {
      ...params,
      task: 'identify-officer',
    });
    expect(identify.subject).toBe(`Reminder: identify the officer for ${ARQ}`);
    expect(identify.text).toContain('The decision is due on 31 October 2026, in 10 days.');
    expect(
      renderTemplate('access-officer-reminder-sms', 'en', { ...params, daysLeft: 0 }).text,
    ).toBe(`Adili: decide request ${ARQ} by 31 October 2026 (today).`);
  });

  it('tells the declarant of a law-enforcement grant after it, naming the agency and date', () => {
    const rendered = renderTemplate('lea-grant-notice-email', 'en', ACCESS_TEMPLATES[6]?.[1]);
    expect(rendered.text).toContain(
      `On 1 October 2026 ${PSC} granted Directorate of Criminal Investigations access to your declaration, on law-enforcement request ${LEA}`,
    );
    expect(rendered.text).toContain('Regulation 23(2)');
  });

  it('tells the declarant their certified copy is ready with its verification code', () => {
    const rendered = renderTemplate('certified-copy-ready-email', 'en', ACCESS_TEMPLATES[8]?.[1]);
    expect(rendered.subject).toBe('Your certified copy of DCB-PSC-2027-0000001-1 is ready');
    expect(rendered.text).toContain('ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K');
    expect(
      issuesOf('certified-copy-ready-sms', {
        ...ACCESS_TEMPLATES[8]?.[1],
        reference: 'DCB-PSC-2027-0000001-2',
      }),
    ).toEqual(['params.reference']);
  });

  it('keeps every SMS to one segment with the longest values but the sign-in link', () => {
    const longest: Record<string, Record<string, unknown>> = {
      'access-acknowledgement': { decideBy: '2026-09-30' },
      'access-request-notified': { respondBy: '2026-09-30' },
      'access-decision-applicant': { outcome: 'partially-granted' },
      'access-decision-declarant': { outcome: 'partially-granted' },
      'access-package-ready': { reference: LONG_LEA, downloadUntil: '2026-09-30' },
      'access-officer-reminder': { task: 'decide', dueDate: '2026-09-30', daysLeft: 366 },
      'lea-grant-notice': { reference: LONG_LEA, grantedOn: '2026-09-30' },
      'lea-decision': { reference: LONG_LEA },
      'certified-copy-ready': {
        reference: 'DCF-ABCDEFGHIJKLMNOPQRST-2027-9999999-V',
        version: 99,
        verificationCode: 'ADL-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZW',
      },
    };
    for (const [name, params] of ACCESS_TEMPLATES) {
      const text = renderTemplate(`${name}-sms` as TemplateId, 'en', {
        ...params,
        ...(params.reference === ARQ ? { reference: LONG_ARQ } : {}),
        commissionName: LONG_COMMISSION,
        ...longest[name],
      }).text;
      expect(text.replace(String(params.signInUrl), '').length, name).toBeLessThanOrEqual(160);
    }
  });
});
