import type { NewEvent } from '@adili/events';

import type { ObligationType } from '../obligations/engine.js';

/**
 * Events the declarations service publishes about declaration drafts (spec 05). Identifiers and
 * states only: no section contents, amounts or names (ADR-013 §3). The `tenant` extension is the
 * Commission's slug; the subject is the declaration.
 */

export const DECLARATION_DRAFT_STARTED = 'declaration.draft-started.v1';

export interface DeclarationDraftStartedData extends Record<string, unknown> {
  declarationId: string;
  obligationId: string;
  type: ObligationType;
}

export function declarationDraftStarted(
  tenant: string,
  data: DeclarationDraftStartedData,
): NewEvent<DeclarationDraftStartedData> {
  return { type: DECLARATION_DRAFT_STARTED, subject: data.declarationId, tenant, data };
}

export const DECLARATION_ATTACHMENT_LINKED = 'declaration.attachment-linked.v1';
export const DECLARATION_ATTACHMENT_UNLINKED = 'declaration.attachment-unlinked.v1';

/** An upload linked to, or unlinked from, an item of a draft. No file name or hash. */
export interface DeclarationAttachmentData extends Record<string, unknown> {
  declarationId: string;
  uploadId: string;
}

export function declarationAttachmentLinked(
  tenant: string,
  data: DeclarationAttachmentData,
): NewEvent<DeclarationAttachmentData> {
  return { type: DECLARATION_ATTACHMENT_LINKED, subject: data.declarationId, tenant, data };
}

export function declarationAttachmentUnlinked(
  tenant: string,
  data: DeclarationAttachmentData,
): NewEvent<DeclarationAttachmentData> {
  return { type: DECLARATION_ATTACHMENT_UNLINKED, subject: data.declarationId, tenant, data };
}

export const DECLARATION_DRAFT_DISCARDED = 'declaration.draft-discarded.v1';

/** A draft the declarant discarded: its sections and attachments are gone. */
export interface DeclarationDraftDiscardedData extends Record<string, unknown> {
  declarationId: string;
}

export function declarationDraftDiscarded(
  tenant: string,
  data: DeclarationDraftDiscardedData,
): NewEvent<DeclarationDraftDiscardedData> {
  return { type: DECLARATION_DRAFT_DISCARDED, subject: data.declarationId, tenant, data };
}
