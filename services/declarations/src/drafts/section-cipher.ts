import { Injectable, Logger } from '@nestjs/common';
import { type createValkey, InjectValkey } from '@adili/cache';
import { FieldCipher } from '@adili/data-access';

import type { StoredEnvelope } from './schema.js';
import type { SectionContents } from './sections.js';

/** A section as stored: ciphertext and envelope, and the version it was saved at. */
export interface SealedSection {
  ciphertext: Buffer;
  envelope: StoredEnvelope;
}

export interface StoredSection extends SealedSection {
  declarationId: string;
  sectionKey: string;
  savedVersion: number;
}

/** How long a decrypted section stays cached for re-renders. */
const CACHE_SECONDS = 600;

/**
 * How long a cache call may take before it counts as failed. An unreachable Valkey queues
 * commands instead of failing them, so without a bound a save or read would wait on it.
 */
const CACHE_WAIT_MS = 250;

type Valkey = Pick<ReturnType<typeof createValkey>, 'get' | 'set'>;

/**
 * Encrypts and decrypts whole section blobs with the Commission's key (ADR-006), the record id
 * `<declarationId>/<sectionKey>` bound into the AAD so a blob cannot move to another section.
 * Decrypted sections are cached in Valkey for ten minutes by (declaration, section, saved
 * version): a cache only, never the source of truth, and a Valkey failure only costs a decrypt.
 * Keys hold identifiers only. Callers read the row from Postgres first (under the person's
 * row-level security), so the cache never answers for a section the caller cannot read.
 */
@Injectable()
export class SectionCipher {
  private readonly logger = new Logger(SectionCipher.name);

  constructor(
    private readonly cipher: FieldCipher,
    @InjectValkey() private readonly valkey: Valkey,
  ) {}

  async seal(
    tenant: string,
    declarationId: string,
    sectionKey: string,
    contents: SectionContents,
  ): Promise<SealedSection> {
    const { ciphertext, envelope } = await this.cipher.encrypt({
      tenant,
      recordId: recordId(declarationId, sectionKey),
      plaintext: JSON.stringify(contents),
    });
    return { ciphertext: Buffer.from(ciphertext, 'base64'), envelope };
  }

  async open(tenant: string, section: StoredSection): Promise<SectionContents> {
    const key = cacheKey(section);
    const cached = await this.cached(key);
    if (cached) return cached;
    const plaintext = await this.cipher.decrypt({
      tenant,
      recordId: recordId(section.declarationId, section.sectionKey),
      ciphertext: section.ciphertext.toString('base64'),
      envelope: section.envelope,
    });
    const contents = JSON.parse(plaintext.toString('utf8')) as SectionContents;
    await this.cache(section, contents);
    return contents;
  }

  /** The sections' contents, in the order given, each keyed by its section. */
  openAll<T extends StoredSection>(
    tenant: string,
    sections: readonly T[],
  ): Promise<{ key: T['sectionKey']; contents: SectionContents }[]> {
    return Promise.all(
      sections.map(async (section) => ({
        key: section.sectionKey,
        contents: await this.open(tenant, section),
      })),
    );
  }

  /** Caches a section just saved, so the next read needs no decrypt. */
  async cache(
    section: Pick<StoredSection, 'declarationId' | 'sectionKey' | 'savedVersion'>,
    contents: SectionContents,
  ): Promise<void> {
    try {
      await withinCacheWait(
        this.valkey.set(cacheKey(section), JSON.stringify(contents), 'EX', CACHE_SECONDS),
      );
    } catch (error) {
      this.logger.warn(`Draft section cache write failed: ${errorName(error)}`);
    }
  }

  private async cached(key: string): Promise<SectionContents | null> {
    try {
      const value = await withinCacheWait(this.valkey.get(key));
      return value === null ? null : (JSON.parse(value) as SectionContents);
    } catch (error) {
      this.logger.warn(`Draft section cache read failed: ${errorName(error)}`);
      return null;
    }
  }
}

function recordId(declarationId: string, sectionKey: string): string {
  return `${declarationId}/${sectionKey}`;
}

function cacheKey({
  declarationId,
  sectionKey,
  savedVersion,
}: Pick<StoredSection, 'declarationId' | 'sectionKey' | 'savedVersion'>): string {
  return `draft-section:${declarationId}:${sectionKey}:${String(savedVersion)}`;
}

class CacheTimeout extends Error {
  override readonly name = 'CacheTimeout';
}

/** Settles with the cache call, or rejects with `CacheTimeout` once it has taken too long. */
async function withinCacheWait<T>(call: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new CacheTimeout());
    }, CACHE_WAIT_MS);
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
