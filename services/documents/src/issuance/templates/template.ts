import type { DisclosureLevel, DocumentType, PublicPayload } from '@adili/events/contracts';
import type { z } from 'zod';

import type { FooterFields } from './page.js';

/** What issuance knows when a template renders: the document's code, time and signer. */
export interface RenderContext {
  verificationId: string;
  issuedAt: Date;
  /** Common name of the signing certificate, shown in the signature note. */
  signerName: string;
}

/**
 * A versioned document template (ADR-010): its payload, its HTML, and its policy. The disclosure
 * level and the public payload are the template's, never the caller's, so a caller cannot
 * publish more of a document than its type allows.
 */
export interface DocumentTemplate<TPayload = unknown> {
  type: DocumentType;
  version: number;
  disclosureLevel: DisclosureLevel;
  /** Human title, e.g. `Acknowledgement slip`. */
  title: string;
  /** The fields the template renders; validated before anything is rendered. */
  payload: z.ZodType<TPayload>;
  /** The reference number the document is about (a declaration's), or null when none. */
  reference(payload: TPayload): string | null;
  /** What the verify page may show; null for confidential documents. */
  publicPayload(payload: TPayload, context: { issuedAt: Date }): PublicPayload | null;
  /** The footer fields the template decides; issuance adds the code, URL and date. */
  footer(payload: TPayload): Pick<FooterFields, 'issuerName' | 'reference' | 'version' | 'mark'>;
  /** The main page's HTML document. */
  render(payload: TPayload, context: RenderContext): string;
}
