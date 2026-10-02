import {
  declarationSchemes,
  GRANT_REFERENCE_PATTERN,
  isGrantReference,
} from '@adili/numbering/references';
import { ACCESS_PACKAGE } from '@adili/events/contracts';
import { z } from 'zod';

import {
  attestation,
  CONTENT_STYLES,
  declarationContent,
  disclosedDeclarationSchema,
} from './declaration-content.js';
import {
  esc,
  formatDate,
  formatDateTime,
  htmlDocument,
  INK,
  LETTERHEAD_STYLES,
  letterhead,
  LINE,
  MUTED,
  SOFT,
  signatureNote,
} from './page.js';
import { commissionRefSchema, DECLARATION_TYPES, isDeclarationReference } from './references.js';
import type { DocumentTemplate } from './template.js';

/** The provisions a grant rests on (declarations' `LegalBasis`). */
const LEGAL_BASES = ['act-s36-1', 'act-s36-2'] as const;
/** The sections a grant discloses (declarations' `DisclosureSection`). */
const DISCLOSURE_SECTIONS = ['bio', 'income', 'assets', 'liabilities', 'other'] as const;

const SECTION_NAMES: Record<(typeof DISCLOSURE_SECTIONS)[number], string> = {
  bio: 'Biodata',
  income: 'Income',
  assets: 'Assets',
  liabilities: 'Liabilities',
  other: 'Other information',
};

/**
 * What the access service hands over for a grant: the declarations service's scoped disclosure
 * (`disclosure.v1`, as rendered for the grant) and what the grant decided. Never stored beyond
 * the PDF.
 */
export const accessPackagePayload = z
  .object({
    disclosure: z.strictObject({
      schemaVersion: z.literal('disclosure.v1'),
      grantReference: z
        .string()
        .regex(GRANT_REFERENCE_PATTERN)
        .refine(isGrantReference, {
          message: 'Must be an ARQ or LEA reference number with a valid check character',
        })
        .meta({
          description: 'The access request (ARQ) or law-enforcement request (LEA) reference',
          examples: ['ARQ-PSC-2026-0000012-H'],
        }),
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
    legalBasis: z.enum(LEGAL_BASES).meta({
      description: 'act-s36-1: an access request (Form K); act-s36-2: a law-enforcement request',
    }),
    recipient: z.strictObject({
      name: z.string().trim().min(1).max(200),
      /** The law-enforcement agency, for a law-enforcement request. */
      organisation: z.string().trim().min(1).max(200).nullable(),
    }),
    grantedAt: z.iso.datetime({ offset: true }),
    /** The scope granted, printed on the package. */
    scope: z.strictObject({
      years: z.array(z.int().min(2000).max(2100)).min(1),
      includeSpouses: z.boolean(),
      includeChildren: z.boolean(),
      sections: z.array(z.enum(DISCLOSURE_SECTIONS)).min(1),
    }),
  })
  .meta({
    description:
      "Payload of access-package v1: the declarations service's scoped disclosure for the grant and what the grant decided",
  });

export type AccessPackagePayload = z.infer<typeof accessPackagePayload>;

const STYLES = `${LETTERHEAD_STYLES}${CONTENT_STYLES}
body{font-size:9.2pt;line-height:1.45}
p{margin:0 0 2.5mm}
.doc-h{margin:7mm 0 5mm}
.doc-h .t1{font-size:17pt;font-weight:700;letter-spacing:-0.01em;line-height:1.2}
.doc-sub{color:${SOFT};font-size:10pt;margin-top:1mm}
.fine{font-size:8.2pt;color:${SOFT}}
.ref{display:flex;align-items:center;justify-content:space-between;gap:4mm;padding:4.5mm 5mm;border:0.35mm solid ${INK};border-radius:2mm}
.lbl{font-size:7.4pt;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}}
.ref .big{font-size:16pt;font-weight:700;margin-top:0.5mm}
.cpill{flex:none;padding:1.2mm 3.2mm;border-radius:999px;background:${INK};color:#fff;font-weight:700;font-size:8pt;letter-spacing:0.14em}
.skv{display:grid;grid-template-columns:44mm 1fr;margin:5mm 0}
.skv dt,.skv dd{margin:0;padding:1.6mm 0;border-bottom:0.25mm solid ${LINE}}
.skv dt{color:${MUTED}}
.skv dd{font-weight:500}
.warn{padding:4mm 5mm;border-radius:2mm;background:#fdf3ec;border:0.3mm solid #f1c3a6;margin:4mm 0}
.warn .t{font-weight:700;margin-bottom:1mm}
.version{margin-top:8mm;break-before:page}
.version .vh{display:flex;align-items:baseline;justify-content:space-between;gap:4mm;padding:3mm 0;border-bottom:0.6mm solid ${INK}}
.version .vh .t{font-size:12.5pt;font-weight:700}
.vpanel{padding:5mm;border-radius:2mm;background:#f6f5f3;margin:6mm 0 4mm;break-inside:avoid}
.vpanel .t{font-size:11pt;font-weight:700;margin-bottom:1.5mm}
.vpanel .vcode{font-size:12pt;font-weight:700;letter-spacing:0.03em;margin:1.5mm 0 2mm}
.signed{display:flex;justify-content:flex-end;break-inside:avoid}`;

const LEGAL_BASIS: Record<AccessPackagePayload['legalBasis'], string> = {
  'act-s36-1': 'Access request under section 36(1) of the Act (Form K)',
  'act-s36-2': 'Law-enforcement request under section 36(2) of the Act (Regulation 23)',
};

function scopeText(scope: AccessPackagePayload['scope']): string[] {
  const years = [...scope.years].sort((a, b) => a - b).join(', ');
  const household = [
    'the declarant',
    ...(scope.includeSpouses ? ['spouses'] : []),
    ...(scope.includeChildren ? ['children'] : []),
  ].join(', ');
  return [
    `Declarations of ${years}`,
    `Persons: ${household}`,
    `Sections: ${scope.sections.map((section) => SECTION_NAMES[section]).join(', ')}`,
  ];
}

/**
 * The access package (Act s.36, spec 10): the scoped disclosure granted on an access request or
 * a law-enforcement request, confidential (the verify page shows validity only), watermarked
 * with its recipient on every page and downloadable by them for a window (ADR-010 §6).
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
    const issuedTo = recipient.organisation
      ? `${recipient.name}, ${recipient.organisation}`
      : recipient.name;
    const versions = disclosure.versions
      .map((entry) => {
        const scheme = declarationSchemes[entry.type];
        return `<section class="version"><div class="vh"><div class="t">${esc(scheme.name)}, ${esc(formatDate(entry.statementDate))}</div><div class="mono nw">${esc(entry.reference)} · Version ${entry.version}</div></div><p class="note">Submitted ${esc(formatDateTime(entry.submittedAt))}.</p>${declarationContent(entry.content, { householdIdentifiers: false })}${attestation(entry.content)}</section>`;
      })
      .join('');
    const body = `${letterhead({ name: disclosure.commission.name, code: disclosure.commission.issuerCode })}
<div class="doc-h"><div class="t1" role="heading" aria-level="1">Access package</div><div class="doc-sub">Disclosure of declarations of income, assets and liabilities</div></div>
<div class="ref"><div><div class="lbl">Request reference</div><div class="big mono nw">${esc(disclosure.grantReference)}</div></div><div class="cpill">CONFIDENTIAL</div></div>
<dl class="skv">
<dt>Issued to</dt><dd>${esc(issuedTo)}</dd>
<dt>Declarant</dt><dd>${esc(disclosure.personName)}</dd>
<dt>Responsible Commission</dt><dd>${esc(disclosure.commission.name)} (${esc(disclosure.commission.issuerCode)})</dd>
<dt>Legal basis</dt><dd>${esc(LEGAL_BASIS[payload.legalBasis])}</dd>
<dt>Granted</dt><dd>${esc(formatDateTime(payload.grantedAt))}</dd>
<dt>Scope granted</dt><dd>${scopeText(payload.scope).map(esc).join('<br />')}</dd>
</dl>
<div class="warn"><div class="t">For the recipient named above only</div><div>This package discloses only what the Commission granted. Publishing or sharing its contents is an offence under section 36(4) of the Act. Every page carries the recipient's name, the request reference and the date of issue.</div></div>
<div class="vpanel"><div class="t">Check that this package is genuine</div><div>Scan the QR code at the foot of any page, or go to the Adili Online verify page and enter:</div><div class="vcode mono nw">${esc(verificationId)}</div><div class="fine">The check shows only whether the package is valid, never its contents or who it was issued to.</div></div>
<div class="signed">${signatureNote(signerName, issuedAt)}</div>
${versions}`;
    return htmlDocument(`Access package ${disclosure.grantReference}`, STYLES, body);
  },
};
