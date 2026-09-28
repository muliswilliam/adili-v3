import { readFileSync } from 'node:fs';

const FIXTURES = new URL('../fixtures/', import.meta.url);

export const fixture = (name: string): Buffer => readFileSync(new URL(name, FIXTURES));

/** A 1x1 transparent PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * The EICAR anti-virus test file, a CSV-looking line every scanner reports as infected. Built
 * at runtime so the repository holds no file a developer's scanner would quarantine.
 */
export const EICAR = Buffer.from(
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''),
);
