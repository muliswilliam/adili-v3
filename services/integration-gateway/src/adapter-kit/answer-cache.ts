import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { InjectValkey } from '@adili/cache';
import type { Redis } from 'iovalkey';
import { z } from 'zod';

import { SUBJECT_HASH_KEY } from '../verification/subject-hasher.js';
import type { CachedAdapter } from './registry-adapter.js';

/** A registry answer worth reusing: the normalised data, or that the registry has no record. */
export type Answer<T> = { found: true; data: T } | { found: false };

/** Marks an entry's format: AES-256-GCM, 12-byte IV, 16-byte tag. */
const SEALED = 'v1';

/**
 * Registry answers in Valkey, keyed by system, operation and subject hash so identifiers never
 * appear in the keyspace, and encrypted (AES-256-GCM, bound to their key): registry records are
 * personal data of declarants and third parties, kept encrypted in the database too. One answer
 * serves every Commission, so the key is the service's own, derived from SUBJECT_HASH_KEY
 * (rotating that changes every cache key anyway). The cache only saves registry calls: when Valkey
 * is down, reads miss and writes are dropped; an entry that does not open is a miss.
 */
@Injectable()
export class AnswerCache {
  private readonly logger = new Logger(AnswerCache.name);
  private readonly key: Buffer;

  constructor(
    @InjectValkey() private readonly valkey: Redis,
    @Inject(SUBJECT_HASH_KEY) secret: string,
  ) {
    this.key = Buffer.from(
      hkdfSync('sha256', secret, '', 'adili:integration-gateway:answer-cache', 32),
    );
  }

  async get<T>(adapter: CachedAdapter<T>, subjectHash: string): Promise<Answer<T> | undefined> {
    let raw: string | null;
    try {
      raw = await this.valkey.get(key(adapter, subjectHash));
    } catch (error) {
      this.logger.warn(
        { system: adapter.system, errorType: errorType(error) },
        'Cache read failed; calling the registry',
      );
      return undefined;
    }
    if (raw === null) return undefined;
    const plaintext = this.open(raw, key(adapter, subjectHash));
    if (plaintext === undefined) return undefined;
    const answer = answerSchema(adapter.schema).safeParse(parseJson(plaintext));
    // An entry of an older shape is a miss; the fresh answer overwrites it.
    return answer.success ? answer.data : undefined;
  }

  async set<T>(
    adapter: CachedAdapter<T>,
    subjectHash: string,
    answer: Answer<T>,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      const entryKey = key(adapter, subjectHash);
      await this.valkey.set(
        entryKey,
        this.seal(JSON.stringify(answer), entryKey),
        'EX',
        ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(
        { system: adapter.system, errorType: errorType(error) },
        'Cache write failed',
      );
    }
  }

  /** `v1.<iv>.<tag>.<ciphertext>`, base64, with the entry's key as associated data. */
  private seal(plaintext: string, entryKey: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(entryKey));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [SEALED, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
      .join('.');
  }

  /** The plaintext of a sealed entry; undefined for one that does not open (older, tampered). */
  private open(raw: string, entryKey: string): string | undefined {
    const [version, iv, tag, ciphertext] = raw.split('.');
    if (version !== SEALED || !iv || !tag || ciphertext === undefined) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(entryKey));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return undefined;
    }
  }
}

const key = (adapter: CachedAdapter<unknown>, subjectHash: string) =>
  `${adapter.system}:${adapter.operation}:${subjectHash}`;

function answerSchema<T>(data: z.ZodType<T>) {
  return z.discriminatedUnion('found', [
    z.object({ found: z.literal(true), data }),
    z.object({ found: z.literal(false) }),
  ]);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
