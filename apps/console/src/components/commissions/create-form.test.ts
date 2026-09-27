import { describe, expect, it } from 'vitest';

import type { DirectoryError, ProblemDetails } from '../../server/directory/client';
import {
  checkDraft,
  checkField,
  type CreateDraft,
  issuerCodeOf,
  normaliseSlug,
  submitFailure,
} from './create-form';

const TSC: CreateDraft = {
  name: 'Teachers Service Commission',
  slug: 'tsc',
  type: 'hosted',
  categories: ['act-s32-10'],
};

const SLUG_ERROR = 'Use 2 to 20 lowercase letters or digits, starting with a letter.';

describe('checkDraft (S19: the same inputs the directory rejects in S5)', () => {
  it('accepts a valid draft and trims the name', () => {
    expect(checkDraft({ ...TSC, name: '  Teachers Service Commission ' })).toEqual({
      ok: true,
      commission: { ...TSC, name: 'Teachers Service Commission' },
    });
  });

  it.each([
    ['Platform', SLUG_ERROR],
    ['platform', 'This key is reserved.'],
    ['new', 'This key is reserved.'],
    ['x', SLUG_ERROR],
    ['too-long-key-abcdefghijk', SLUG_ERROR],
    ['1tsc', SLUG_ERROR],
    ['', SLUG_ERROR],
  ])('rejects the key %j', (slug, message) => {
    expect(checkDraft({ ...TSC, slug })).toEqual({ ok: false, errors: { slug: message } });
  });

  it('rejects an unknown or repeated category', () => {
    const categoriesError =
      'One of the selected categories is not in the statutory list. Reload the page and choose again.';
    expect(checkDraft({ ...TSC, categories: ['act-s32-10', 'act-s32-99'] })).toEqual({
      ok: false,
      errors: { categories: categoriesError },
    });
    expect(checkDraft({ ...TSC, categories: ['act-s32-10', 'act-s32-10'] })).toEqual({
      ok: false,
      errors: { categories: categoriesError },
    });
  });

  it('reports every invalid field with the specified copy', () => {
    expect(
      checkDraft({ name: ' TS ', slug: 'Platform', type: '', categories: ['act-s32-99'] }),
    ).toEqual({
      ok: false,
      errors: {
        name: "Enter the Commission's name (3 to 120 characters).",
        slug: SLUG_ERROR,
        type: 'Choose how the Commission will use the platform.',
        categories:
          'One of the selected categories is not in the statutory list. Reload the page and choose again.',
      },
    });
  });

  it('accepts no categories and a 120-character name, not 121', () => {
    expect(checkDraft({ ...TSC, categories: [], name: 'a'.repeat(120) }).ok).toBe(true);
    expect(checkField({ ...TSC, name: 'a'.repeat(121) }, 'name')).toBe(
      "Enter the Commission's name (3 to 120 characters).",
    );
    expect(checkField({ ...TSC, name: 'a'.repeat(121) }, 'slug')).toBeUndefined();
  });
});

describe('Commission key input', () => {
  it('forces lowercase and drops spaces, keeping other characters for the error', () => {
    expect(normaliseSlug('Ts C')).toBe('tsc');
    expect(normaliseSlug('TSC-1')).toBe('tsc-1');
  });

  it('previews the issuer code only for a usable key', () => {
    expect(issuerCodeOf('tsc')).toBe('TSC');
    expect(issuerCodeOf('cpsb047')).toBe('CPSB047');
    expect(issuerCodeOf('t')).toBeNull();
    expect(issuerCodeOf('platform')).toBeNull();
  });
});

const problem = (fields: Partial<ProblemDetails> & { status: number }): DirectoryError => ({
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Error', ...fields },
});

describe('submitFailure', () => {
  it('maps a 409 slug and name to the fields and asks for a new key', () => {
    const failure = submitFailure(
      problem({
        status: 409,
        type: 'commission-exists',
        errors: [
          { path: 'slug', message: 'taken' },
          { path: 'name', message: 'taken' },
        ],
      }),
      TSC,
    );

    expect(failure).toEqual({
      fieldErrors: {
        slug: 'The key tsc is already used by another Commission.',
        name: 'A Commission with this name already exists.',
      },
      unmapped: [],
      alert: null,
      newKey: true,
    });
  });

  it('shows the conflict alert when a 409 names no field', () => {
    expect(submitFailure(problem({ status: 409 }), TSC)).toMatchObject({
      fieldErrors: {},
      alert: 'conflict',
    });
  });

  it('maps 400 paths to fields and lists the rest in the summary', () => {
    const failure = submitFailure(
      problem({
        status: 400,
        errors: [
          { path: 'categories.1', message: 'Invalid option' },
          { path: 'issuerCode', message: 'Unrecognized key' },
          { path: '', message: 'Body must be an object' },
        ],
      }),
      TSC,
    );

    expect(failure.fieldErrors).toEqual({
      categories:
        'One of the selected categories is not in the statutory list. Reload the page and choose again.',
    });
    expect(failure.unmapped).toEqual(['issuerCode: Unrecognized key', 'Body must be an object']);
    expect(failure.alert).toBeNull();
    expect(failure.newKey).toBe(true);
  });

  it('keeps the key after network errors and 5xx, so the retry is safe', () => {
    expect(submitFailure({ kind: 'unavailable', detail: null }, TSC)).toEqual({
      fieldErrors: {},
      unmapped: [],
      alert: 'error',
      newKey: false,
    });
  });

  it('keeps the key while the first attempt is still running', () => {
    expect(
      submitFailure(problem({ status: 409, type: 'idempotency-key-in-use' }), TSC),
    ).toMatchObject({ alert: 'in-progress', newKey: false });
  });

  it('warns when the key was used for a different request (422)', () => {
    expect(
      submitFailure(problem({ status: 422, type: 'idempotency-key-reused' }), TSC),
    ).toMatchObject({ alert: 'changed', newKey: true });
  });

  it('reports a 403 as forbidden', () => {
    expect(submitFailure(problem({ status: 403 }), TSC)).toMatchObject({ alert: 'forbidden' });
  });
});
