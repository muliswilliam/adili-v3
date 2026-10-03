import { Injectable } from '@nestjs/common';
import { FieldCipher } from '@adili/data-access';

import type { SealedSection } from '../drafts/section-cipher.js';
import type { MatchKey } from './match-keys.js';

/**
 * What a suggestion holds of a registry record, encrypted as one blob: the proposed fields, the
 * registry's identifiers and facts (`sourceRef`), and the normalised identifiers it is matched
 * on. Personal data throughout.
 */
export interface SuggestionContents {
  fields: Record<string, unknown>;
  sourceRef: Record<string, unknown>;
  matchKeys: MatchKey[];
}

/**
 * Encrypts and decrypts suggestion contents with the Commission's key (ADR-006), the record id
 * `<declarationId>/suggestions/<suggestionId>` bound into the AAD so a blob cannot move to
 * another suggestion or declaration. No cache: a list decrypts a handful per registry. The
 * reason a declarant gives for a dismissal is sealed the same way, as a record of its own
 * (`.../<suggestionId>/reason`).
 */
@Injectable()
export class SuggestionCipher {
  constructor(private readonly cipher: FieldCipher) {}

  async seal(
    tenant: string,
    declarationId: string,
    suggestionId: string,
    contents: SuggestionContents,
  ): Promise<SealedSection> {
    const { ciphertext, envelope } = await this.cipher.encrypt({
      tenant,
      recordId: recordId(declarationId, suggestionId),
      plaintext: JSON.stringify(contents),
    });
    return { ciphertext: Buffer.from(ciphertext, 'base64'), envelope };
  }

  async open(
    tenant: string,
    declarationId: string,
    suggestionId: string,
    sealed: SealedSection,
  ): Promise<SuggestionContents> {
    const plaintext = await this.cipher.decrypt({
      tenant,
      recordId: recordId(declarationId, suggestionId),
      ciphertext: sealed.ciphertext.toString('base64'),
      envelope: sealed.envelope,
    });
    return JSON.parse(plaintext.toString('utf8')) as SuggestionContents;
  }

  async sealReason(
    tenant: string,
    declarationId: string,
    suggestionId: string,
    reason: string,
  ): Promise<SealedSection> {
    const { ciphertext, envelope } = await this.cipher.encrypt({
      tenant,
      recordId: reasonRecordId(declarationId, suggestionId),
      plaintext: reason,
    });
    return { ciphertext: Buffer.from(ciphertext, 'base64'), envelope };
  }
}

/** The record id a dismissal's reason is sealed under, bound into its AAD. */
export function reasonRecordId(declarationId: string, suggestionId: string): string {
  return `${recordId(declarationId, suggestionId)}/reason`;
}

function recordId(declarationId: string, suggestionId: string): string {
  return `${declarationId}/suggestions/${suggestionId}`;
}
