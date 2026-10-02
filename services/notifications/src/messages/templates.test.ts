import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { renderTemplate } from './templates.js';

describe('renderTemplate', () => {
  it('escapes params in the HTML body but not in the text body', () => {
    const rendered = renderTemplate('onboarding-otp-email', 'en', {
      code: '123456',
      commissionName: 'Teachers <Service> & Co',
      expiresInMinutes: 10,
    });

    expect(rendered.html).toContain('Teachers &lt;Service&gt; &amp; Co');
    expect(rendered.text).toContain('Teachers <Service> & Co');
  });

  it('reads naturally without a Commission name', () => {
    const rendered = renderTemplate('onboarding-otp-email', 'en', {
      code: '123456',
      expiresInMinutes: 10,
    });

    expect(rendered.text).toContain('setting up your declarant account. It expires in 10 minutes.');
  });

  it('names the Commission in the onboarding SMS and says to ignore an unrequested code', () => {
    const rendered = renderTemplate('onboarding-otp-sms', 'en', {
      code: '123456',
      commissionName: 'Teachers Service Commission',
      expiresInMinutes: 10,
    });

    expect(rendered.text).toBe(
      'Adili: your code to set up your account with Teachers Service Commission is 123456. It expires in 10 minutes. Did not ask for it? Ignore this SMS. Do not share it.',
    );
  });

  it('uses the singular for one minute', () => {
    const rendered = renderTemplate('login-otp-sms', 'en', { code: '1234', expiresInMinutes: 1 });

    expect(rendered.text).toBe(
      'Adili: your sign-in code is 1234. It expires in 1 minute. Do not share it.',
    );
  });

  it('falls back to English for an untranslated locale', () => {
    const params = { code: '1234', expiresInMinutes: 5 };

    expect(renderTemplate('login-otp-sms', 'sw', params)).toEqual(
      renderTemplate('login-otp-sms', 'en', params),
    );
  });

  it('reports invalid params with paths under params', () => {
    expect(() => renderTemplate('login-otp-sms', 'en', { code: 'abc' })).toThrow(ZodError);
    try {
      renderTemplate('login-otp-sms', 'en', { code: 'abc' });
    } catch (error) {
      expect((error as ZodError).issues.map((issue) => issue.path.join('.'))).toEqual([
        'params.code',
        'params.expiresInMinutes',
      ]);
    }
  });
});

describe('obligation reminder templates', () => {
  const params = {
    type: 'biennial',
    commissionName: 'Public Service Commission',
    statementDate: '2027-11-01',
    dueDate: '2027-12-31',
    daysLeft: 30,
    portalUrl: 'https://portal.adili.go.ke',
  };

  it('renders the SMS with type, Commission, due date, days left and portal link', () => {
    expect(renderTemplate('obligation-reminder-sms', 'en', params).text).toBe(
      'Adili: your biennial declaration for Public Service Commission is due on 31 December 2027 (30 days). Sign in at https://portal.adili.go.ke',
    );
  });

  it.each([
    [1, '(1 day)'],
    [0, '(today)'],
  ])('says %i days left as %s', (daysLeft, phrase) => {
    const text = renderTemplate('obligation-reminder-sms', 'en', { ...params, daysLeft }).text;

    expect(text).toContain(`is due on 31 December 2027 ${phrase}.`);
  });

  it('renders the email with every param in subject, text and HTML', () => {
    const rendered = renderTemplate('obligation-reminder-email', 'en', {
      ...params,
      type: 'initial',
      statementDate: '2028-02-29',
      dueDate: '2028-03-30',
      daysLeft: 7,
    });

    expect(rendered.subject).toBe('Reminder: your initial declaration is due on 30 March 2028');
    expect(rendered.text).toBe(
      [
        'Your initial declaration for Public Service Commission is due on 30 March 2028, in 7 days.',
        'It declares your income, assets and liabilities as at the statement date, 29 February 2028.',
        'Sign in to Adili Online at https://portal.adili.go.ke to see your declarations and their due dates.',
        'If you have already declared by other means, contact your Commission. Adili Online will never ask you for your password or sign-in code.',
      ].join('\n\n'),
    );
    expect(rendered.html).toContain(
      '<a href="https://portal.adili.go.ke">https://portal.adili.go.ke</a>',
    );
    expect(rendered.html).toContain('29 February 2028');
  });

  it('says due today in the email when no days are left', () => {
    const rendered = renderTemplate('obligation-reminder-email', 'en', { ...params, daysLeft: 0 });

    expect(rendered.subject).toBe('Reminder: your biennial declaration is due today');
    expect(rendered.text).toContain('is due on 31 December 2027, today.');
  });

  it('escapes the Commission name and portal link in the HTML body', () => {
    const rendered = renderTemplate('obligation-reminder-email', 'en', {
      ...params,
      commissionName: 'Teachers <Service> & Co',
      portalUrl: 'https://portal.adili.go.ke/?a=1&b="2"',
    });

    expect(rendered.html).toContain('Teachers &lt;Service&gt; &amp; Co');
    expect(rendered.html).toContain('href="https://portal.adili.go.ke/?a=1&amp;b=&quot;2&quot;"');
    expect(rendered.html).not.toContain('<Service>');
  });

  it.each([
    ['an unknown type', { type: 'annual' }, ['params.type']],
    ['a date that is not a calendar date', { dueDate: '2027-02-30' }, ['params.dueDate']],
    ['a date with a time', { statementDate: '2027-11-01T00:00:00Z' }, ['params.statementDate']],
    ['a due date before the statement date', { dueDate: '2027-10-31' }, ['params.dueDate']],
    ['negative days left', { daysLeft: -1 }, ['params.daysLeft']],
    ['fractional days left', { daysLeft: 1.5 }, ['params.daysLeft']],
    [
      'a portal link that is not http(s)',
      { portalUrl: 'javascript:alert(1)' },
      ['params.portalUrl'],
    ],
    ['an empty Commission name', { commissionName: ' ' }, ['params.commissionName']],
    ['an unexpected param', { officerName: 'Wanjiku' }, ['params']],
  ])('rejects %s', (_case, change, paths) => {
    for (const template of ['obligation-reminder-sms', 'obligation-reminder-email'] as const) {
      try {
        renderTemplate(template, 'en', { ...params, ...change });
        expect.unreachable('params should be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        expect((error as ZodError).issues.map((issue) => issue.path.join('.'))).toEqual(paths);
      }
    }
  });

  it('rejects missing params', () => {
    try {
      renderTemplate('obligation-reminder-sms', 'en', {});
      expect.unreachable('params should be rejected');
    } catch (error) {
      expect((error as ZodError).issues.map((issue) => issue.path.join('.')).sort()).toEqual([
        'params.commissionName',
        'params.daysLeft',
        'params.dueDate',
        'params.portalUrl',
        'params.statementDate',
        'params.type',
      ]);
    }
  });
});

describe('acknowledgement templates', () => {
  const params = {
    reference: 'DCB-PSC-2027-0000001-1',
    type: 'biennial',
    version: 1,
    commissionName: 'Public Service Commission',
    statementDate: '2027-11-01',
    verificationCode: 'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K',
    portalUrl: 'https://portal.adili.go.ke/declarations',
  };

  it('renders the SMS with the reference and verification code only', () => {
    const text = renderTemplate('acknowledgement-sms', 'en', params).text;

    expect(text).toBe(
      'Adili: declaration DCB-PSC-2027-0000001-1 received. Verification code ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K. Slip in Adili Online.',
    );
    expect(text).not.toContain('Public Service Commission');
    expect(text).not.toContain('https://');
  });

  it('names the version of an amendment in the SMS', () => {
    const text = renderTemplate('acknowledgement-sms', 'en', { ...params, version: 2 }).text;

    expect(text).toBe(
      'Adili: declaration DCB-PSC-2027-0000001-1 version 2 received. Verification code ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K. Slip in Adili Online.',
    );
  });

  it('accepts an issuer longer than 8 characters, as tenant keys allow', () => {
    const text = renderTemplate('acknowledgement-sms', 'en', {
      ...params,
      reference: 'DCB-NAIROBICOUNTY-2027-0000003-M',
    }).text;

    expect(text).toContain('declaration DCB-NAIROBICOUNTY-2027-0000003-M received.');
  });

  it('keeps the SMS to one segment with the longest issuer, version and code', () => {
    const text = renderTemplate('acknowledgement-sms', 'en', {
      ...params,
      reference: 'DCF-ABCDEFGHIJKLMNOPQRST-2027-9999999-V',
      type: 'final',
      version: 99,
      verificationCode: 'ADL-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZW',
    }).text;

    expect(text.length).toBeLessThanOrEqual(160);
  });

  it('renders the email with every param in subject, text and HTML, and no attachment', () => {
    const rendered = renderTemplate('acknowledgement-email', 'en', {
      ...params,
      reference: 'DCI-TSC-2028-0012345-U',
      type: 'initial',
      commissionName: 'Teachers Service Commission',
      statementDate: '2028-02-29',
    });

    expect(rendered.subject).toBe('Declaration DCI-TSC-2028-0012345-U received');
    expect(rendered.text).toBe(
      [
        'Your initial declaration for Teachers Service Commission has been received. Its reference number is DCI-TSC-2028-0012345-U.',
        'It declares your income, assets and liabilities as at the statement date, 29 February 2028.',
        'Your acknowledgement slip is ready. Its verification code is ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K: anyone you show the slip to can use it, or the QR code on the slip, to check that it is genuine.',
        'Sign in to Adili Online at https://portal.adili.go.ke/declarations to download the slip. It is not attached to this email, so that only you can open it.',
        'If you did not submit this declaration, contact your Commission at once. Adili Online will never ask you for your password or sign-in code.',
      ].join('\n\n'),
    );
    expect(rendered.html).toContain(
      '<a href="https://portal.adili.go.ke/declarations">https://portal.adili.go.ke/declarations</a>',
    );
    expect(rendered.html).toContain('DCI-TSC-2028-0012345-U');
    expect(rendered.html).toContain('ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K');
    expect(rendered.html).toContain('29 February 2028');
    expect(Object.keys(rendered).sort()).toEqual(['html', 'subject', 'text']);
  });

  it('says an amendment is a new version of the same reference that supersedes the old slip', () => {
    const rendered = renderTemplate('acknowledgement-email', 'en', { ...params, version: 3 });

    expect(rendered.subject).toBe('Declaration DCB-PSC-2027-0000001-1 version 3 received');
    expect(rendered.text).toContain(
      'Version 3 of your biennial declaration for Public Service Commission, your amendment, has been received. Its reference number stays DCB-PSC-2027-0000001-1.',
    );
    expect(rendered.text).toContain(
      'Your acknowledgement slip for version 3 is ready and replaces the slip for the previous version, which now shows as superseded. Its verification code is ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K',
    );
    expect(rendered.html).toContain('Version 3 of your biennial declaration');
  });

  it('escapes the Commission name and portal link in the HTML body', () => {
    const rendered = renderTemplate('acknowledgement-email', 'en', {
      ...params,
      commissionName: 'Teachers <Service> & Co',
      portalUrl: 'https://portal.adili.go.ke/?a=1&b="2"',
    });

    expect(rendered.html).toContain('Teachers &lt;Service&gt; &amp; Co');
    expect(rendered.html).toContain('href="https://portal.adili.go.ke/?a=1&amp;b=&quot;2&quot;"');
    expect(rendered.html).not.toContain('<Service>');
  });

  it('falls back to English for Swahili', () => {
    for (const template of ['acknowledgement-sms', 'acknowledgement-email'] as const) {
      expect(renderTemplate(template, 'sw', params)).toEqual(
        renderTemplate(template, 'en', params),
      );
    }
  });

  it.each([
    ['a reference of another scheme', { reference: 'OFR-0482913-L' }, ['params.reference']],
    [
      'a reference with a bad check character',
      { reference: 'DCB-PSC-2027-0000001-2' },
      ['params.reference'],
    ],
    ['a lower-case reference', { reference: 'dcb-psc-2027-0000001-1' }, ['params.reference']],
    ['a type the reference does not carry', { type: 'final' }, ['params.type']],
    ['an unknown type', { type: 'annual' }, ['params.type']],
    [
      'an issuer over 20 characters',
      { reference: 'DCB-ABCDEFGHIJKLMNOPQRSTU-2027-0000001-1' },
      ['params.reference'],
    ],
    ['version 0', { version: 0 }, ['params.version']],
    ['a fractional version', { version: 1.5 }, ['params.version']],
    ['a version over 99', { version: 100 }, ['params.version']],
    ['a version as a string', { version: '2' }, ['params.version']],
    [
      'a verification code without the ADL prefix',
      { verificationCode: '7Q4K-M2XR-9HTC' },
      ['params.verificationCode'],
    ],
    [
      'a verification code with markup',
      { verificationCode: 'ADL-<b>' },
      ['params.verificationCode'],
    ],
    [
      'a verification code over 40 characters',
      { verificationCode: `ADL${'-ABCD'.repeat(8)}` },
      ['params.verificationCode'],
    ],
    [
      'a verification code of five groups (22 characters, not 26)',
      { verificationCode: 'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-9K' },
      ['params.verificationCode'],
    ],
    [
      'a verification code with a letter outside Crockford base32',
      { verificationCode: 'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9U' },
      ['params.verificationCode'],
    ],
    [
      'a verification code not in its printed form',
      { verificationCode: 'adl-7q4k-m2xr-9htc-2b7f-q3zd-8wna-9k' },
      ['params.verificationCode'],
    ],
    [
      'a date that is not a calendar date',
      { statementDate: '2027-02-30' },
      ['params.statementDate'],
    ],
    [
      'a portal link that is not http(s)',
      { portalUrl: 'javascript:alert(1)' },
      ['params.portalUrl'],
    ],
    ['an empty Commission name', { commissionName: ' ' }, ['params.commissionName']],
    ['an unexpected param', { declarantName: 'Wanjiku' }, ['params']],
  ])('rejects %s', (_case, change, paths) => {
    for (const template of ['acknowledgement-sms', 'acknowledgement-email'] as const) {
      try {
        renderTemplate(template, 'en', { ...params, ...change });
        expect.unreachable('params should be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        expect((error as ZodError).issues.map((issue) => issue.path.join('.'))).toEqual(paths);
      }
    }
  });

  it('rejects missing params', () => {
    try {
      renderTemplate('acknowledgement-email', 'en', {});
      expect.unreachable('params should be rejected');
    } catch (error) {
      expect((error as ZodError).issues.map((issue) => issue.path.join('.')).sort()).toEqual([
        'params.commissionName',
        'params.portalUrl',
        'params.reference',
        'params.statementDate',
        'params.type',
        'params.verificationCode',
        'params.version',
      ]);
    }
  });
});

describe('clarification templates', () => {
  const portalUrl =
    'https://portal.adili.go.ke/clarifications/0199a8f0-5555-7000-8000-000000000001';
  const issued = {
    reference: 'CLR-PSC-2028-0000451-1',
    commissionName: 'Public Service Commission',
    dueDate: '2028-09-30',
    portalUrl,
  };
  const reminder = { ...issued, daysLeft: 10 };
  const CASES = [
    ['clarification-issued-sms', issued],
    ['clarification-issued-email', issued],
    ['clarification-reminder-sms', reminder],
    ['clarification-reminder-email', reminder],
  ] as const;

  it('renders the issued SMS with the Commission, reference, due date and portal link', () => {
    expect(renderTemplate('clarification-issued-sms', 'en', issued).text).toBe(
      `Adili: Public Service Commission has sent you clarification request CLR-PSC-2028-0000451-1. Respond by 30 September 2028 at ${portalUrl}`,
    );
  });

  it('renders the issued email with every param in subject, text and HTML, and no attachment', () => {
    const rendered = renderTemplate('clarification-issued-email', 'en', issued);

    expect(rendered.subject).toBe('Clarification request CLR-PSC-2028-0000451-1');
    expect(rendered.text).toBe(
      [
        'Public Service Commission has sent you a clarification request about your declaration. Its reference number is CLR-PSC-2028-0000451-1.',
        'Please respond by 30 September 2028. You can still respond after that date, but your response will be recorded as late.',
        `Sign in to Adili Online at ${portalUrl} to read the letter and respond. It is not attached to this email, so that only you can open it.`,
        'If you have questions about this request, contact your Commission. Adili Online will never ask you for your password or sign-in code.',
      ].join('\n\n'),
    );
    expect(rendered.html).toContain(`<a href="${portalUrl}">${portalUrl}</a>`);
    expect(rendered.html).toContain('CLR-PSC-2028-0000451-1');
    expect(rendered.html).toContain('30 September 2028');
    expect(Object.keys(rendered).sort()).toEqual(['html', 'subject', 'text']);
  });

  it('renders the reminder SMS with the reference, due date, days left and portal link', () => {
    expect(renderTemplate('clarification-reminder-sms', 'en', reminder).text).toBe(
      `Adili: clarification request CLR-PSC-2028-0000451-1 is due on 30 September 2028 (10 days). Respond at ${portalUrl}`,
    );
  });

  it.each([
    [1, '(1 day)'],
    [0, '(today)'],
  ])('says %i days left in the reminder SMS as %s', (daysLeft, phrase) => {
    const text = renderTemplate('clarification-reminder-sms', 'en', { ...reminder, daysLeft }).text;

    expect(text).toContain(`is due on 30 September 2028 ${phrase}.`);
  });

  it('renders the reminder email with every param in subject, text and HTML', () => {
    const rendered = renderTemplate('clarification-reminder-email', 'en', reminder);

    expect(rendered.subject).toBe(
      'Reminder: clarification request CLR-PSC-2028-0000451-1 is due on 30 September 2028',
    );
    expect(rendered.text).toBe(
      [
        'You have not yet responded to clarification request CLR-PSC-2028-0000451-1 from Public Service Commission. Your response is due on 30 September 2028, in 10 days. You can still respond after that date, but your response will be recorded as late.',
        `Sign in to Adili Online at ${portalUrl} to read the letter and respond.`,
        'If you have questions about this request, contact your Commission. Adili Online will never ask you for your password or sign-in code.',
      ].join('\n\n'),
    );
    expect(rendered.html).toContain(`<a href="${portalUrl}">${portalUrl}</a>`);
  });

  it('says due today in the reminder email when no days are left', () => {
    const rendered = renderTemplate('clarification-reminder-email', 'en', {
      ...reminder,
      daysLeft: 0,
    });

    expect(rendered.subject).toBe(
      'Reminder: clarification request CLR-PSC-2028-0000451-1 is due today',
    );
    expect(rendered.text).toContain('Your response is due today, 30 September 2028.');
  });

  it('keeps each SMS to two GSM segments with the longest issuer and a long Commission', () => {
    const long = {
      reference: 'CLR-ABCDEFGHIJKLMNOPQRST-2028-9999999-7',
      commissionName: 'Ethics and Anti-Corruption Commission',
    };
    for (const [template, params] of [
      ['clarification-issued-sms', { ...issued, ...long }],
      ['clarification-reminder-sms', { ...reminder, ...long, daysLeft: 366 }],
    ] as const) {
      const { text } = renderTemplate(template, 'en', params);
      // Two concatenated GSM-7 segments carry 153 characters each; plain ASCII stays GSM-7.
      expect(text.length).toBeLessThanOrEqual(306);
      expect(text).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('escapes the Commission name and portal link in the HTML bodies', () => {
    for (const [template, params] of CASES.filter(([id]) => id.endsWith('-email'))) {
      const rendered = renderTemplate(template, 'en', {
        ...params,
        commissionName: 'Teachers <Service> & Co',
        portalUrl: 'https://portal.adili.go.ke/?a=1&b="2"',
      });

      expect(rendered.html).toContain('Teachers &lt;Service&gt; &amp; Co');
      expect(rendered.html).toContain('href="https://portal.adili.go.ke/?a=1&amp;b=&quot;2&quot;"');
      expect(rendered.html).not.toContain('<Service>');
    }
  });

  it('falls back to English for Swahili', () => {
    for (const [template, params] of CASES) {
      expect(renderTemplate(template, 'sw', params)).toEqual(
        renderTemplate(template, 'en', params),
      );
    }
  });

  it.each([
    ['a declaration reference', { reference: 'DCB-PSC-2027-0000001-1' }, ['params.reference']],
    [
      'a reference with a bad check character',
      { reference: 'CLR-PSC-2028-0000451-2' },
      ['params.reference'],
    ],
    ['a lower-case reference', { reference: 'clr-psc-2028-0000451-1' }, ['params.reference']],
    ['a date that is not a calendar date', { dueDate: '2028-02-30' }, ['params.dueDate']],
    ['a date with a time', { dueDate: '2028-09-30T00:00:00Z' }, ['params.dueDate']],
    [
      'a portal link that is not http(s)',
      { portalUrl: 'javascript:alert(1)' },
      ['params.portalUrl'],
    ],
    ['an empty Commission name', { commissionName: ' ' }, ['params.commissionName']],
    ['an unexpected param', { declarantName: 'Wanjiku' }, ['params']],
  ])('rejects %s', (_case, change, paths) => {
    for (const [template, params] of CASES) {
      try {
        renderTemplate(template, 'en', { ...params, ...change });
        expect.unreachable('params should be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        expect((error as ZodError).issues.map((issue) => issue.path.join('.'))).toEqual(paths);
      }
    }
  });

  it.each([
    ['negative days left', -1],
    ['fractional days left', 1.5],
    ['days left as a string', '10'],
  ])('rejects %s in the reminder', (_case, daysLeft) => {
    for (const [template, params] of CASES.filter(([id]) => id.includes('-reminder-'))) {
      try {
        renderTemplate(template, 'en', { ...params, daysLeft });
        expect.unreachable('params should be rejected');
      } catch (error) {
        expect((error as ZodError).issues.map((issue) => issue.path.join('.'))).toEqual([
          'params.daysLeft',
        ]);
      }
    }
  });

  it('takes days left only in the reminder', () => {
    for (const [template] of CASES.filter(([id]) => id.includes('-issued-'))) {
      expect(() => renderTemplate(template, 'en', reminder)).toThrow(ZodError);
    }
  });

  it('rejects missing params', () => {
    try {
      renderTemplate('clarification-reminder-email', 'en', {});
      expect.unreachable('params should be rejected');
    } catch (error) {
      expect((error as ZodError).issues.map((issue) => issue.path.join('.')).sort()).toEqual([
        'params.commissionName',
        'params.daysLeft',
        'params.dueDate',
        'params.portalUrl',
        'params.reference',
      ]);
    }
  });
});
