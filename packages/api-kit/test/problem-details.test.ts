import { readFileSync } from 'node:fs';

import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { PROBLEM_CODES, problemCodeSchema } from '../src/problem-codes.js';
import { ProblemException, toProblemDetails } from '../src/problem-details.filter.js';

describe('toProblemDetails', () => {
  it('renders the extension members of a problem next to the standard ones (RFC 9457 §3.2)', () => {
    const exception = new ProblemException(
      {
        type: 'import-in-progress',
        title: 'Import in progress',
        status: 409,
        detail: 'Another import is still running.',
      },
      { importId: '0199a1b2-0000-7000-8000-000000000001' },
    );

    expect(toProblemDetails(exception, '/v1/imports')).toEqual({
      type: 'import-in-progress',
      title: 'Import in progress',
      status: 409,
      detail: 'Another import is still running.',
      importId: '0199a1b2-0000-7000-8000-000000000001',
      instance: '/v1/imports',
    });
  });

  it('keeps the standard members when an extension names one of them', () => {
    const exception = new ProblemException(
      { type: 'conflict', title: 'Conflict', status: 409 },
      { status: 200, type: 'other' },
    );

    expect(toProblemDetails(exception, '/x')).toMatchObject({ type: 'conflict', status: 409 });
  });

  it('renders the problem a failed query wraps, such as the database being unavailable', () => {
    const unavailable = new ProblemException({
      type: 'database-unavailable',
      title: 'Service unavailable',
      status: 503,
    });

    expect(
      toProblemDetails(new DrizzleQueryError('select 1', [], unavailable), '/v1/verify/x'),
    ).toEqual({
      type: 'database-unavailable',
      title: 'Service unavailable',
      status: 503,
      instance: '/v1/verify/x',
    });
  });

  it('keeps a failed query that wraps an ordinary error a 500', () => {
    const failed = new DrizzleQueryError('select 1', [], new Error('relation does not exist'));

    expect(toProblemDetails(failed, '/x')).toMatchObject({ status: 500 });
  });
});

describe('ProblemException.fromCode', () => {
  it('renders the registered status and title, with the code as type and code', () => {
    const exception = ProblemException.fromCode('otp-invalid', {
      detail: 'Wrong code.',
      extensions: { attemptsLeft: 2 },
    });

    expect(exception.getStatus()).toBe(400);
    expect(toProblemDetails(exception, '/v1/onboarding/sessions/s/otp/email/verify')).toEqual({
      type: 'otp-invalid',
      code: 'otp-invalid',
      title: 'Invalid code',
      status: 400,
      detail: 'Wrong code.',
      attemptsLeft: 2,
      instance: '/v1/onboarding/sessions/s/otp/email/verify',
    });
  });

  it('keeps the code when an extension names it', () => {
    const exception = ProblemException.fromCode('no-match', { extensions: { code: 'other' } });

    expect(toProblemDetails(exception, '/x')).toMatchObject({ code: 'no-match', status: 404 });
  });

  it('tells problems by code', () => {
    const noRoster = ProblemException.fromCode('no-roster');

    expect(ProblemException.hasCode(noRoster, ['no-match', 'no-roster'])).toBe(true);
    expect(ProblemException.hasCode(noRoster, ['no-match'])).toBe(false);
    expect(ProblemException.hasCode(new Error('no-roster'), ['no-roster'])).toBe(false);
    expect(
      ProblemException.hasCode(
        new ProblemException({ type: 'no-roster', title: 'Untyped', status: 409 }),
        ['no-roster'],
      ),
    ).toBe(false);
  });
});

/** The values of every `code` property's enum in a JSON Schema. */
function codeEnums(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const { properties } = schema as { properties?: { code?: { enum?: string[] } } };
  return [
    ...(properties?.code?.enum ?? []),
    ...Object.values(schema).flatMap((child) => codeEnums(child)),
  ];
}

describe('PROBLEM_CODES', () => {
  /** The directory contract, with the drafted onboarding operations of spec 03. */
  const directory = readFileSync(
    new URL('../../schemas/internal/directory.yaml', import.meta.url),
    'utf8',
  );

  it("lists every code the directory's onboarding routes send", () => {
    const contract = parse(directory) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown>; responses: Record<string, unknown> };
    };
    const onboarding = Object.entries(contract.paths).filter(([path]) =>
      path.startsWith('/v1/onboarding/'),
    );
    const described = [
      ...JSON.stringify([onboarding, contract.components.responses]).matchAll(
        /[Pp]roblem codes? `([a-z-]+)`(?: or `([a-z-]+)`)?/g,
      ),
    ].flatMap((match) => match.slice(1).filter(Boolean));
    const enumerated = codeEnums(contract.components.schemas.OnboardingProblem);

    const used = new Set([...described, ...enumerated]);
    expect(used.size).toBeGreaterThanOrEqual(10);
    expect([...used].filter((code) => !(code in PROBLEM_CODES))).toEqual([]);
  });

  it('is the enum of the contract code member', () => {
    expect(problemCodeSchema.options).toEqual(Object.keys(PROBLEM_CODES));
  });
});
