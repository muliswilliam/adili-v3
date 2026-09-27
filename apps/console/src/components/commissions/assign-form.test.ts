import { describe, expect, it } from 'vitest';

import type { DirectoryError, ProblemDetails } from '../../server/directory/client';
import { type AssignDraft, assignFailure, checkAssignDraft, checkAssignField } from './assign-form';

const DRAFT: AssignDraft = {
  name: 'Fatuma Wanjiru',
  email: 'fatuma.wanjiru@tsc.go.ke',
  phone: '0712 345 678',
};

const NAME_ERROR = "Enter the officer's full name.";
const EMAIL_ERROR = 'Enter a valid official email address.';
const PHONE_ERROR = 'Enter a valid phone number, e.g. 0712 345 678 or +254 712 345 678.';

const problem = (fields: Partial<ProblemDetails> & { status: number }): DirectoryError => ({
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Problem', ...fields },
});

describe('checkAssignDraft', () => {
  it('sends the officer normalised: trimmed name, lower-case email, E.164 phone', () => {
    expect(
      checkAssignDraft({
        name: '  Fatuma Wanjiru ',
        email: ' Fatuma.Wanjiru@TSC.go.ke ',
        phone: '0712 345 678',
      }),
    ).toEqual({
      ok: true,
      officer: {
        name: 'Fatuma Wanjiru',
        email: 'fatuma.wanjiru@tsc.go.ke',
        phone: '+254712345678',
      },
    });
  });

  it('accepts an international phone number', () => {
    expect(checkAssignDraft({ ...DRAFT, phone: '+44 20 7946 0958' })).toMatchObject({
      ok: true,
      officer: { phone: '+442079460958' },
    });
  });

  it('lists one message per invalid field with the spec copy', () => {
    expect(checkAssignDraft({ name: 'F', email: 'fatuma@', phone: '12345' })).toEqual({
      ok: false,
      errors: { name: NAME_ERROR, email: EMAIL_ERROR, phone: PHONE_ERROR },
    });
  });

  it.each([
    ['name', { name: '  ' }, NAME_ERROR],
    ['name', { name: 'x'.repeat(121) }, NAME_ERROR],
    ['email', { email: '' }, EMAIL_ERROR],
    ['email', { email: 'fatuma wanjiru@tsc.go.ke' }, EMAIL_ERROR],
    ['email', { email: `${'a'.repeat(250)}@tsc.go.ke` }, EMAIL_ERROR],
    ['phone', { phone: '' }, PHONE_ERROR],
    ['phone', { phone: '071234567' }, PHONE_ERROR],
  ] as const)('rejects %s %j', (field, change, message) => {
    expect(checkAssignField({ ...DRAFT, ...change }, field)).toBe(message);
  });

  it('reports a valid field as valid while another is not', () => {
    expect(checkAssignField({ ...DRAFT, email: 'nope' }, 'phone')).toBeUndefined();
  });
});

describe('assignFailure', () => {
  it('shows a retryable error and keeps the key after network errors and 5xx', () => {
    expect(assignFailure({ kind: 'unavailable', detail: null })).toEqual({
      fieldErrors: {},
      unmapped: [],
      alert: 'error',
      newKey: false,
    });
  });

  it('says the officer was assigned and keeps the key when only the email failed', () => {
    expect(
      assignFailure({ kind: 'unavailable', detail: null, problemType: 'invitation-not-sent' }),
    ).toEqual({ fieldErrors: {}, unmapped: [], alert: 'not-sent', newKey: false });
  });

  it('asks to wait, with a new key, while another change of the officer is running', () => {
    expect(assignFailure(problem({ status: 409, type: 'reporting-officer-busy' }))).toMatchObject({
      alert: 'busy',
      newKey: true,
    });
  });

  it('keeps the key while the first attempt is still in progress', () => {
    expect(assignFailure(problem({ status: 409, type: 'idempotency-key-in-use' }))).toMatchObject({
      alert: 'in-progress',
      newKey: false,
    });
  });

  it('puts the other-tenant conflict on the email field', () => {
    expect(
      assignFailure(
        problem({
          status: 409,
          type: 'email-belongs-to-other-tenant',
          errors: [{ path: 'email', message: 'belongs to another Commission' }],
        }),
      ),
    ).toEqual({
      fieldErrors: { email: 'This email already belongs to an account in another Commission.' },
      unmapped: [],
      alert: null,
      newKey: true,
    });
  });

  it('maps 400 paths to fields and lists the rest', () => {
    expect(
      assignFailure(
        problem({
          status: 400,
          errors: [
            { path: 'phone', message: 'Enter the phone number in E.164 format' },
            { path: '', message: 'Unrecognized key: "role"' },
          ],
        }),
      ),
    ).toEqual({
      fieldErrors: { phone: PHONE_ERROR },
      unmapped: ['Unrecognized key: "role"'],
      alert: 'rejected',
      newKey: true,
    });
  });

  it.each([
    [problem({ status: 409, type: 'reporting-officer-changed' }), 'officer-changed'],
    [problem({ status: 404 }), 'not-found'],
    [problem({ status: 403 }), 'forbidden'],
    [problem({ status: 422, type: 'idempotency-key-reused' }), 'changed'],
  ] as const)('shows %j as %s with a new key', (error, alert) => {
    expect(assignFailure(error)).toMatchObject({ alert, newKey: true });
  });
});
