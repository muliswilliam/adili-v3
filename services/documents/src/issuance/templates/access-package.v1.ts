import { declarationSchemes } from '@adili/numbering/references';
import { ACCESS_PACKAGE } from '@adili/events/contracts';
import { z } from 'zod';

import {
  grantedScopeSchema,
  grantRecipientSchema,
  grantReferenceSchema,
  issuedTo,
  LEGAL_BASIS_TEXT,
  legalBasisSchema,
  scopeText,
} from './access-grant.js';
import {
  attestation,
  CONTENT_STYLES,
  declarationContent,
  disclosedDeclarationSchema,
} from './declaration-content.js';
import {
  DECLARATION_DOCUMENT_STYLES,
  esc,
  formatDate,
  formatDateTime,
  htmlDocument,
  INK,
  LETTERHEAD_STYLES,
  letterhead,
  signatureNote,
  verificationPanel,
} from './page.js';
import { commissionRefSchema, DECLARATION_TYPES, isDeclarationReference } from './references.js';
import type { DocumentTemplate } from './template.js';

const CLARIFICATION_STATUSES = ['issued', 'overdue', 'responded', 'resolved'] as const;

/**
 * A clarification a Form K grant discloses (review's `DisclosedClarification`): issued on one of
 * the disclosed declarations, each item as its letter put it with the declarant's answer, cut to
 * the granted scope by the review service.
 */
const disclosedClarificationSchema = z.strictObject({
  declarationReference: z.string(),
  reference: z.string().trim().min(1).max(64),
  status: z.enum(CLARIFICATION_STATUSES),
  issuedAt: z.iso.datetime({ offset: true }),
  dueAt: z.iso.datetime({ offset: true }),
  respondedAt: z.iso.datetime({ offset: true }).nullable(),
  responseLate: z.boolean(),
  resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  items: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(500),
        requirementLabel: z.string().trim().min(1).max(200),
        text: z.string().trim().min(1).max(2000),
        response: z
          .strictObject({
            text: z.string().trim().min(1).max(4000),
            attachmentNames: z.array(z.string().trim().min(1).max(255)).max(50),
          })
          .nullable(),
      }),
    )
    .min(1)
    .max(50),
});

type DisclosedClarification = z.infer<typeof disclosedClarificationSchema>;

/**
 * What the access service hands over for a grant: the declarations service's scoped disclosure
 * (`disclosure.v1`, as rendered for the grant), the clarifications the review service disclosed
 * with it when the grant includes them, and what the grant decided. Never stored beyond the PDF.
 */
export const accessPackagePayload = z
  .object({
    disclosure: z.strictObject({
      schemaVersion: z.literal('disclosure.v1'),
      grantReference: grantReferenceSchema,
      personName: z.string().trim().min(1).max(200),
      commission: commissionRefSchema,
      versions: z
        .array(
          z.strictObject({
            reference: z.string().refine(isDeclarationReference, {
              message: 'Must be a declaration reference number with a valid check character',
            }),
            version: z.int().min(1),
            type: z.enum(DECLARATION_TYPES),
            statementDate: z.iso.date(),
            submittedAt: z.iso.datetime({ offset: true }),
            content: disclosedDeclarationSchema,
          }),
        )
        .min(1),
    }),
    legalBasis: legalBasisSchema,
    recipient: grantRecipientSchema,
    grantedAt: z.iso.datetime({ offset: true }),
    /** The scope granted, printed on the package. */
    scope: grantedScopeSchema,
    clarifications: z.array(disclosedClarificationSchema).max(1000).nullable().meta({
      description:
        'The clarifications of the disclosed declarations, as the review service disclosed them for the grant (oldest issued first; empty when none was issued in the scope); null when the grant does not include clarifications',
    }),
  })
  .superRefine((payload, context) => {
    if (payload.scope.includeClarifications !== (payload.clarifications !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['clarifications'],
        message: 'must be given exactly when the scope includes clarifications',
      });
    }
    const disclosed = new Set(payload.disclosure.versions.map((version) => version.reference));
    for (const [index, clarification] of (payload.clarifications ?? []).entries()) {
      if (!disclosed.has(clarification.declarationReference)) {
        context.addIssue({
          code: 'custom',
          path: ['clarifications', index, 'declarationReference'],
          message: 'must be one of the disclosed declarations',
        });
      }
    }
  })
  .meta({
    description:
      "Payload of access-package v1: the declarations service's scoped disclosure for the grant, the clarifications disclosed with it, and what the grant decided",
  });

export type AccessPackagePayload = z.infer<typeof accessPackagePayload>;

const STYLES = `${LETTERHEAD_STYLES}${CONTENT_STYLES}${DECLARATION_DOCUMENT_STYLES}
.cpill{flex:none;padding:1.2mm 3.2mm;border-radius:999px;background:${INK};color:#fff;font-weight:700;font-size:8pt;letter-spacing:0.14em}
.warn{padding:4mm 5mm;border-radius:2mm;background:#fdf3ec;border:0.3mm solid #f1c3a6;margin:4mm 0}
.warn .t{font-weight:700;margin-bottom:1mm}
.version{margin-top:8mm;break-before:page}
.version .vh{display:flex;align-items:baseline;justify-content:space-between;gap:4mm;padding:3mm 0;border-bottom:0.6mm solid ${INK}}
.version .vh .t{font-size:12.5pt;font-weight:700}
.clar{margin:4mm 0 0;break-inside:avoid-page}
.clar .cl{font-weight:600;margin:3mm 0 1mm;break-after:avoid}`;

/** Where a clarification stands, as the package prints it under its reference. */
function clarificationState(clarification: DisclosedClarification): string {
  const issued = `Issued ${formatDate(clarification.issuedAt)}`;
  const answered = clarification.respondedAt
    ? `answered ${formatDate(clarification.respondedAt)}${clarification.responseLate ? ', after the due date' : ''}`
    : null;
  switch (clarification.status) {
    case 'issued':
      return `${issued}; an answer is due by ${formatDate(clarification.dueAt)}`;
    case 'overdue':
      return `${issued}; not answered by ${formatDate(clarification.dueAt)}`;
    case 'responded':
      return `${issued}; ${answered ?? 'answered'}`;
    case 'resolved':
      return `${issued}; ${answered ?? 'answered'}; resolved${clarification.resolvedAt ? ` ${formatDate(clarification.resolvedAt)}` : ''}`;
  }
}

function clarificationItem(item: DisclosedClarification['items'][number]): string {
  const answer = item.response
    ? `<dt>Answer</dt><dd>${esc(item.response.text)}</dd>${
        item.response.attachmentNames.length
          ? `<dt>Attached</dt><dd>${item.response.attachmentNames.map(esc).join(', ')}<div class="note">The attached files are not part of this package.</div></dd>`
          : ''
      }`
    : '<dt>Answer</dt><dd class="nil">Not answered</dd>';
  return `<div class="cl">${esc(item.label)}</div><dl class="kv"><dt>Required</dt><dd>${esc(item.requirementLabel)}</dd><dt>Request</dt><dd>${esc(item.text)}</dd>${answer}</dl>`;
}

/** The clarifications issued on one disclosed declaration, when the grant includes them. */
function clarificationsOf(
  reference: string,
  clarifications: readonly DisclosedClarification[] | null,
): string {
  if (clarifications === null) return '';
  const issued = clarifications.filter((each) => each.declarationReference === reference);
  const body = issued.length
    ? issued
        .map(
          (clarification) =>
            `<div class="clar"><h3 class="mono nw">${esc(clarification.reference)}</h3><p class="note">${esc(clarificationState(clarification))}.</p>${clarification.items.map(clarificationItem).join('')}</div>`,
        )
        .join('')
    : '<p class="nil">No clarification within the granted scope was issued on this declaration.</p>';
  return `<section class="sec"><h2>Clarifications</h2>${body}</section>`;
}

/**
 * The access package (Act s.36, spec 10): the scoped disclosure granted on an access request or
 * a law-enforcement request, with each declaration's clarifications when a Form K grant includes
 * them; confidential (the verify page shows validity only), watermarked with its recipient on
 * every page and downloadable by them for a window (ADR-010 §6).
 */
export const accessPackageV1: DocumentTemplate<AccessPackagePayload> = {
  type: ACCESS_PACKAGE,
  version: 1,
  disclosureLevel: 'confidential',
  title: 'Access package',
  requires: { watermark: true, downloadWindow: true, subjectPerson: true },
  payload: accessPackagePayload,

  reference(payload) {
    return payload.disclosure.grantReference;
  },

  subjectVersion() {
    return null;
  },

  publicPayload() {
    return null;
  },

  footer(payload) {
    return {
      issuerName: payload.disclosure.commission.name,
      reference: payload.disclosure.grantReference,
      version: null,
      mark: 'CONFIDENTIAL',
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const { disclosure, recipient } = payload;
    const versions = disclosure.versions
      .map((entry) => {
        const scheme = declarationSchemes[entry.type];
        return `<section class="version"><div class="vh"><div class="t">${esc(scheme.name)}, ${esc(formatDate(entry.statementDate))}</div><div class="mono nw">${esc(entry.reference)} · Version ${entry.version}</div></div><p class="note">Submitted ${esc(formatDateTime(entry.submittedAt))}.</p>${declarationContent(entry.content, { householdIdentifiers: false })}${attestation(entry.content)}${clarificationsOf(entry.reference, payload.clarifications)}</section>`;
      })
      .join('');
    const body = `${letterhead({ name: disclosure.commission.name, code: disclosure.commission.issuerCode })}
<div class="doc-h"><div class="t1" role="heading" aria-level="1">Access package</div><div class="doc-sub">Disclosure of declarations of income, assets and liabilities</div></div>
<div class="ref"><div><div class="lbl">Request reference</div><div class="big mono nw">${esc(disclosure.grantReference)}</div></div><div class="cpill">CONFIDENTIAL</div></div>
<dl class="skv">
<dt>Issued to</dt><dd>${esc(issuedTo(recipient))}</dd>
<dt>Declarant</dt><dd>${esc(disclosure.personName)}</dd>
<dt>Responsible Commission</dt><dd>${esc(disclosure.commission.name)} (${esc(disclosure.commission.issuerCode)})</dd>
<dt>Legal basis</dt><dd>${esc(LEGAL_BASIS_TEXT[payload.legalBasis])}</dd>
<dt>Granted</dt><dd>${esc(formatDateTime(payload.grantedAt))}</dd>
<dt>Scope granted</dt><dd>${scopeText(payload.scope).map(esc).join('<br />')}</dd>
</dl>
<div class="warn"><div class="t">For the recipient named above only</div><div>This package discloses only what the Commission granted. Publishing or sharing its contents is an offence under section 36(4) of the Act. Every page carries the recipient's name, the request reference and the date of issue.</div></div>
${verificationPanel('package', verificationId, 'The check shows only whether the package is valid, never its contents or who it was issued to.')}
<div class="signed">${signatureNote(signerName, issuedAt)}</div>
${versions}`;
    return htmlDocument(`Access package ${disclosure.grantReference}`, STYLES, body);
  },
};
