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
