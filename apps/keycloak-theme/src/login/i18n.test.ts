// Runs in jsdom, so paths are relative to the package root (vitest's working directory).
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Keycloakify builds the theme's messages bundle, which Keycloak resolves server-side keys from
 * (e.g. the adili-otp authenticator's `adiliOtpTooManyAttempts`), by evaluating the argument of
 * `withCustomTranslations` on its own. A variable or TypeScript syntax there silently leaves the
 * bundle without the theme's keys, so this evaluates it the same way.
 */
describe('i18n.ts', () => {
  it('passes Keycloakify a table it can evaluate at build time', () => {
    const source = readFileSync('src/login/i18n.ts', 'utf8');
    const start = source.indexOf('.withCustomTranslations(') + '.withCustomTranslations('.length;
    const end = source.indexOf(')\n  .build()', start);
    const argument = source.slice(start, end);

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const evaluate = new Function(`return (${argument});`) as () => Record<
      string,
      Record<string, string>
    >;
    const table = evaluate();

    expect(table.en?.adiliOtpTooManyAttempts).toMatch(/^Too many wrong codes/);
    expect(table.en?.adiliOtpTooManyResends).toMatch(/^Too many codes requested/);
    expect(table.en?.expiredCodeMessage).toBeDefined();
  });
});
