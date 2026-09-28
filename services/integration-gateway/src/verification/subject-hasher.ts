import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

export const SUBJECT_HASH_KEY = Symbol('SUBJECT_HASH_KEY');

/** Keyed hash of a looked-up identifier: stable per subject, not reversible by enumeration. */
@Injectable()
export class SubjectHasher {
  constructor(@Inject(SUBJECT_HASH_KEY) private readonly key: string) {}

  hash(system: string, identifier: string): string {
    return createHmac('sha256', this.key).update(`${system}:${identifier}`).digest('hex');
  }
}
