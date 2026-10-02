import { declarationSchemes, RFL } from '@adili/numbering/references';
import { REFERRAL_PACKAGE } from '@adili/events/contracts';
import { DeclarationSchema } from '@adili/forms';
import { z } from 'zod';

import { attestation, CONTENT_STYLES, declarationContent } from './declaration-content.js';
import { letterCommissionSchema } from './letter.js';
import {
  DECLARATION_DOCUMENT_STYLES,
  esc,
  formatDate,
  formatDateTime,
  htmlDocument,
  LETTERHEAD_STYLES,
  letterhead,
  LINE,
  MUTED,
  RULED_TABLE_STYLES,
  signatureNote,
  twoLineHash,
  verificationPanel,
} from './page.js';
import {
  DECLARATION_TYPES,
  isDeclarationReference,
  numberedBy,
  referenceOf,
} from './references.js';
import type { DocumentTemplate } from './template.js';

/** review.yaml `ReferralGrounds`. */
const GROUNDS = [
  'undeclared-assets',
  'unexplained-assets',
  'two-missed-cycles',
  'unanswered-clarification',
] as const;
type Grounds = (typeof GROUNDS)[number];

/** review.yaml `ReferralManifestKind`: what an item of the package is. */
const MANIFEST_KINDS = [
  'declaration-version',
  'declaration-attachment',
  'flag',
  'clarification',
  'clarification-attachment',
  'obligation',
  'letter',
] as const;
type ManifestKind = (typeof MANIFEST_KINDS)[number];

const KIND_NAMES: Record<ManifestKind, string> = {
  'declaration-version': 'Declaration version',
  'declaration-attachment': 'Declaration attachment',
  flag: 'Risk flag',
  clarification: 'Clarification and response',
  'clarification-attachment': 'Clarification attachment',
  obligation: 'Filing obligation',
  letter: 'Letter',
};

const LEGAL_BASIS: Record<Grounds, string> = {
  'undeclared-assets':
    'Regulation 20(1)(c): referral to the Ethics and Anti-Corruption Commission of cases of undeclared or unexplained assets liable for forfeiture.',
  'unexplained-assets':
    'Regulation 20(1)(c): referral to the Ethics and Anti-Corruption Commission of cases of undeclared or unexplained assets liable for forfeiture.',
  'two-missed-cycles': 'Regulation 20(2).',
  'unanswered-clarification': 'Regulation 20(2).',
};

/** What Act s.35(4) requires of each clarification item (review's `REQUIREMENTS`). */
const REQUIREMENT_LABELS: Record<string, string> = {
  'provide-omitted': 'Provide the omitted information',
  'explain-discrepancy': 'Explain the discrepancy or inconsistency',
  correct: 'Correct the entry',
};

/** `overdue` as `Overdue`, `two-words` as `Two words`: a status or severity code as words. */
function words(code: string): string {
  const spaced = code.replaceAll('-', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.iso.datetime({ offset: true });

/** review.yaml `ReferralManifestItem`. */
const manifestItemSchema = z.object({
  kind: z.enum(MANIFEST_KINDS),
  reference: z.string().trim().min(1).max(500),
  /** SHA-256 of the item as the package includes it, or of the file (uploads and letters). */
  sha256: SHA256,
  /** The upload (attachments) or issued document (letters); null for records. */
  documentId: z.uuid().nullable(),
});

/** A risk flag as the package includes it: an indicator, never a finding. */
const flagSchema = z.looseObject({
  caseReference: z.string().min(1),
  ruleId: z.string().min(1),
  severity: z.string().min(1),
  title: z.string().min(1),
  indicator: z.string().min(1),
  evidence: z.unknown(),
  reviewedAt: instant.nullable(),
  reviewNote: z.string().nullable(),
});

/** A clarification as the package includes it: the request, and the declarant's response. */
const clarificationSchema = z.looseObject({
  reference: z.string().nullable(),
  status: z.string().min(1),
  items: z.array(
    z.looseObject({
      id: z.string(),
      requirement: z.string(),
      text: z.string(),
      aiJobId: z.string().nullable().optional(),
    }),
  ),
  issuedAt: instant.nullable(),
  dueAt: instant.nullable(),
  respondedAt: instant.nullable(),
  response: z
    .looseObject({
      items: z.array(z.looseObject({ itemId: z.string(), text: z.string() })),
      attachments: z.array(z.looseObject({ itemId: z.string(), sha256: SHA256 })),
      submittedAt: instant,
    })
    .nullable(),
});

/**
 * What the review service's referral package payload endpoint returns
 * (`internalGetReferralPackagePayload`, review.yaml `ReferralPackagePayload`): the cover sheet,
 * the manifest of what the package includes with each item's SHA-256, and the evidence itself.
 * The documents service pulls it by referral id; nothing of it is stored beyond the PDF.
 */
export const referralPackagePayload = z
  .object({
    reference: referenceOf(RFL),
    grounds: z.enum(GROUNDS),
    groundsLabel: z.string().trim().min(1).max(200),
    cycleYear: z.int().min(2000).max(2200),
    commission: letterCommissionSchema,
    declarant: z.object({
      name: z.string().trim().min(1).max(200),
      personnelFileNumber: z.string().trim().min(1).max(50),
    }),
    narrative: z.string().trim().min(1).max(10_000),
    proposedBy: z.string().trim().min(1).max(200),
    proposedAt: instant,
    approvedBy: z.string().trim().min(1).max(200),
    approvedAt: instant,
    manifest: z.array(manifestItemSchema).min(1).max(5000),
    versions: z
      .array(
        z.object({
          reference: z.string().refine(isDeclarationReference, {
            message: 'Must be a declaration reference number with a valid check character',
          }),
          version: z.int().min(1),
          type: z.enum(DECLARATION_TYPES),
          statementDate: z.iso.date(),
          submittedAt: instant,
          late: z.boolean(),
          /** The declaration.v1 document as submitted. */
          document: DeclarationSchema,
        }),
      )
      .max(200),
    flags: z.array(flagSchema).max(5000),
    clarifications: z.array(clarificationSchema).max(1000),
    obligations: z
      .array(
        z.object({
          cycleKey: z.string().min(1),
          type: z.string().min(1),
          status: z.string().min(1),
          dueDate: z.iso.date(),
          filedAt: instant.nullable(),
        }),
      )
      .max(1000),
    letters: z.array(z.object({ reference: z.string().min(1), documentId: z.uuid() })).max(2000),
  })
  .refine((payload) => numberedBy(payload.reference, RFL, payload.commission.issuerCode), {
    message: "The RFL reference number is not the Commission's",
    path: ['reference'],
  })
  .meta({
    description:
      "Payload of referral-package v1: the review service's referral package payload (cover sheet, manifest with SHA-256 hashes and evidence), pulled by referral id",
  });

export type ReferralPackagePayload = z.infer<typeof referralPackagePayload>;

const STYLES = `${LETTERHEAD_STYLES}${CONTENT_STYLES}${DECLARATION_DOCUMENT_STYLES}${RULED_TABLE_STYLES}
.cpill{flex:none;padding:1.2mm 3.2mm;border-radius:999px;background:#c9291e;color:#fff;font-weight:700;font-size:8.2pt;letter-spacing:0.08em}
.doc-h{margin:5mm 0 4mm}
.to{margin:3mm 0;line-height:1.45}
.skv{margin:3mm 0}
.skv dt,.skv dd{padding:1.1mm 0}
.vpanel{padding:4mm 5mm;margin:4mm 0 3mm}
.close{break-inside:avoid}
.prose{white-space:pre-line;overflow-wrap:anywhere}
.conf{margin:4mm 0;padding:3mm 4mm;border:0.3mm solid #f1c2be;border-left:1.2mm solid #c9291e;border-radius:1mm;font-size:8.4pt;color:#5c1510;break-inside:avoid}
.part{break-before:page}
.part h2.ph{font-size:13pt;font-weight:700;margin:0 0 3mm}
.card{border:0.25mm solid ${LINE};border-radius:1.6mm;padding:3mm 4mm;margin:0 0 3mm;break-inside:avoid}
.card .h{font-weight:700}
.card .s{color:${MUTED};font-size:8pt}
.ind{display:inline-block;padding:0.2mm 1.6mm;border-radius:0.8mm;background:#f1f0ed;font-size:7.6pt;font-weight:600;margin-left:1.5mm}
.ai{display:inline-block;padding:0.2mm 1.6mm;border-radius:0.8mm;background:#eef2fb;color:#23407a;font-size:7.6pt;font-weight:600;margin-left:1.5mm}
.ev{margin:1.5mm 0 0;padding:0;list-style:none;font-size:8pt}
.version{break-before:page}
.version .vh{display:flex;justify-content:space-between;gap:4mm;padding-bottom:2mm;border-bottom:0.35mm solid #1a1a1a}
.version .vh .t{font-size:12pt;font-weight:700}`;

function manifestTable(manifest: ReferralPackagePayload['manifest']): string {
  const rows = manifest
    .map(
      (item, index) =>
        `<tr><td class="n">${index + 1}</td><td>${esc(KIND_NAMES[item.kind])}${item.documentId ? `<span class="sub mono">${esc(item.documentId)}</span>` : ''}</td><td class="mono">${esc(item.reference)}</td><td>${twoLineHash(item.sha256)}</td></tr>`,
    )
    .join('');
  return `<table class="ft"><thead><tr><th class="n">No</th><th>Item</th><th>Reference</th><th style="width:52mm">SHA-256</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** A flag's evidence as `key: value` lines; it holds clear facts only (counts, percentages). */
function evidenceLines(evidence: unknown): string {
  if (evidence === null || typeof evidence !== 'object') return '';
  const lines = Object.entries(evidence as Record<string, unknown>).map(
    ([key, value]) =>
      `<li><span class="s">${esc(key)}:</span> ${esc(typeof value === 'string' ? value : JSON.stringify(value))}</li>`,
  );
  return lines.length === 0 ? '' : `<ul class="ev">${lines.join('')}</ul>`;
}

function flagsPart(flags: ReferralPackagePayload['flags']): string {
  if (flags.length === 0) return '';
  const cards = flags
    .map((flag) => {
      const reviewed = flag.reviewedAt
        ? `<div class="s">Reviewed ${esc(formatDateTime(flag.reviewedAt))}${flag.reviewNote ? `: ${esc(flag.reviewNote)}` : ''}</div>`
        : '<div class="s">Not reviewed</div>';
      return `<div class="card"><div class="h">${esc(flag.title)}<span class="ind">${esc(words(flag.severity))}</span></div><div class="s mono">${esc(flag.caseReference)} · ${esc(flag.ruleId)}</div><p>${esc(flag.indicator)}</p>${evidenceLines(flag.evidence)}${reviewed}</div>`;
    })
    .join('');
  return `<section class="sec"><h2>Risk flags</h2><p class="fine">Each flag is an indicator for the reviewer's judgement, not a finding.</p>${cards}</section>`;
}

function clarificationsPart(clarifications: ReferralPackagePayload['clarifications']): string {
  if (clarifications.length === 0) return '';
  const cards = clarifications
    .map((clarification) => {
      const answers = new Map(
        (clarification.response?.items ?? []).map((item) => [item.itemId, item.text]),
      );
      const attachments = clarification.response?.attachments ?? [];
      const items = clarification.items
        .map((item, index) => {
          const ai = item.aiJobId ? '<span class="ai">AI-assisted draft</span>' : '';
          const answer = answers.get(item.id);
          const attached = attachments.filter((each) => each.itemId === item.id).length;
          return `<li><b>${index + 1}. ${esc(REQUIREMENT_LABELS[item.requirement] ?? words(item.requirement))}</b>${ai}<p class="prose">${esc(item.text)}</p>${answer ? `<p class="prose"><span class="s">Response:</span> ${esc(answer)}</p>` : '<p class="s">No response</p>'}${attached > 0 ? `<p class="s">${attached} attachment${attached === 1 ? '' : 's'}, listed in the manifest</p>` : ''}</li>`;
        })
        .join('');
      const dates = [
        clarification.issuedAt ? `Issued ${formatDate(clarification.issuedAt)}` : null,
        clarification.dueAt ? `due ${formatDate(clarification.dueAt)}` : null,
        clarification.respondedAt ? `responded ${formatDate(clarification.respondedAt)}` : null,
      ].filter((each): each is string => each !== null);
      return `<div class="card"><div class="h mono">${esc(clarification.reference ?? 'Clarification')}<span class="ind">${esc(words(clarification.status))}</span></div><div class="s">${esc(dates.join(' · '))}</div><ol class="ev">${items}</ol></div>`;
    })
    .join('');
  return `<section class="sec"><h2>Clarifications</h2>${cards}</section>`;
}

function obligationsPart(obligations: ReferralPackagePayload['obligations']): string {
  if (obligations.length === 0) return '';
  const rows = obligations
    .map(
      (obligation) =>
        `<tr><td class="mono">${esc(obligation.cycleKey)}</td><td>${esc(words(obligation.status))}</td><td>${esc(formatDate(obligation.dueDate))}</td><td>${obligation.filedAt ? esc(formatDateTime(obligation.filedAt)) : 'Not filed'}</td></tr>`,
    )
    .join('');
  return `<section class="sec"><h2>Filing obligations</h2><table class="ft"><thead><tr><th>Cycle</th><th>Status</th><th>Due</th><th>Filed</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function lettersPart(letters: ReferralPackagePayload['letters']): string {
  if (letters.length === 0) return '';
  const rows = letters
    .map(
      (letter) =>
        `<tr><td class="mono">${esc(letter.reference)}</td><td class="mono">${esc(letter.documentId)}</td></tr>`,
    )
    .join('');
  return `<section class="sec"><h2>Letters</h2><p class="fine">Issued and signed separately through Adili Online; each is listed in the manifest with the SHA-256 of its signed PDF.</p><table class="ft"><thead><tr><th>Reference</th><th>Document</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function evidence(payload: ReferralPackagePayload): string {
  const parts = [
    obligationsPart(payload.obligations),
    flagsPart(payload.flags),
    clarificationsPart(payload.clarifications),
    lettersPart(payload.letters),
  ].join('');
  return parts || '<p>No records besides the declaration versions that follow.</p>';
}

function versionsPart(
  versions: ReferralPackagePayload['versions'],
  commission: ReferralPackagePayload['commission'],
): string {
  return versions
    .map((entry) => {
      const scheme = declarationSchemes[entry.type];
      const late = entry.late ? ' Submitted after the due date.' : '';
      // The referral is the Commission's own: the declaration names it by its tenant key.
      const ref = { ...commission, slug: entry.document.officer.employment.responsibleCommission };
      return `<section class="version"><div class="vh"><div class="t">${esc(scheme.name)}, ${esc(formatDate(entry.statementDate))}</div><div class="mono nw">${esc(entry.reference)} · Version ${entry.version}</div></div><p class="note">Submitted ${esc(formatDateTime(entry.submittedAt))}.${late}</p>${declarationContent(entry.document, { householdIdentifiers: true, commission: ref })}${attestation(entry.document)}</section>`;
    })
    .join('');
}

/**
 * A referral's evidence package for EACC (spec 08, Regs r.20): the cover sheet (grounds, legal
 * basis, public officer, narrative, who proposed and approved it), the manifest of every item
 * with its SHA-256, then the evidence. Confidential: the verify page shows validity only, and
 * the declarant, who is not told of the referral, can never download it.
 */
export const referralPackageV1: DocumentTemplate<ReferralPackagePayload> = {
  type: REFERRAL_PACKAGE,
  version: 1,
  disclosureLevel: 'confidential',
  title: 'Referral package',
  payload: referralPackagePayload,

  reference(payload) {
    return payload.reference;
  },

  subjectVersion() {
    return null;
  },

  publicPayload() {
    return null;
  },

  footer(payload) {
    return {
      issuerName: payload.commission.name,
      reference: payload.reference,
      version: null,
      mark: 'CONFIDENTIAL',
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const { commission } = payload;
    const count = payload.manifest.length;
    const body = `${letterhead({ name: commission.name, code: commission.issuerCode })}
<div class="doc-h"><div class="t1" role="heading" aria-level="1">Referral to the Ethics and Anti-Corruption Commission</div><div class="doc-sub">Evidence package · cover sheet</div></div>
<div class="ref"><div><div class="lbl">Referral reference</div><div class="big mono nw">${esc(payload.reference)}</div></div><div class="cpill">CONFIDENTIAL</div></div>
<div class="to"><b>The Secretary / Chief Executive Officer</b><br />Ethics and Anti-Corruption Commission<br />Through Adili Online, EACC referrals</div>
<dl class="skv">
<dt>Grounds</dt><dd>${esc(payload.groundsLabel)}</dd>
<dt>Legal basis</dt><dd>${esc(LEGAL_BASIS[payload.grounds])}</dd>
<dt>Cycle</dt><dd>${payload.cycleYear}</dd>
<dt>Public officer</dt><dd>${esc(payload.declarant.name)}<br />Personnel file ${esc(payload.declarant.personnelFileNumber)}</dd>
<dt>Referring Commission</dt><dd>${esc(commission.name)} (${esc(commission.issuerCode)})</dd>
<dt>Proposed by</dt><dd>${esc(payload.proposedBy)}, ${esc(formatDateTime(payload.proposedAt))}</dd>
<dt>Approved by</dt><dd>${esc(payload.approvedBy)}, ${esc(formatDateTime(payload.approvedAt))}</dd>
<dt>Package</dt><dd>${count} item${count === 1 ? '' : 's'}, listed with their SHA-256 hashes in the manifest</dd>
</dl>
<h2 class="lbl">Narrative</h2>
<p class="prose">${esc(payload.narrative)}</p>
<div class="conf"><b>Confidential.</b> The public officer has not been told about this referral. Use it only for investigation and do not disclose it. The public verify page shows only whether this document is valid.</div>
<div class="close">
${verificationPanel('package', verificationId, 'The check shows only whether the package is valid, never its contents or who it is about.')}
<div class="signed">${signatureNote(signerName, issuedAt)}</div>
</div>
<section class="part"><h2 class="ph">Manifest</h2>
<p>Each item the referral rests on, with the SHA-256 of its content as included here (canonical JSON for records, the file's own hash for uploads and letters). Recompute a hash to confirm nothing changed. This package's own hash is in its verification record.</p>
${manifestTable(payload.manifest)}</section>
<section class="part"><h2 class="ph">Evidence</h2>
${evidence(payload)}</section>
${versionsPart(payload.versions, commission)}`;
    return htmlDocument(`Referral package ${payload.reference}`, STYLES, body);
  },
};
