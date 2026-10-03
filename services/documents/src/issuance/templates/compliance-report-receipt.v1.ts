import { RPT } from '@adili/numbering/references';
import { COMPLIANCE_REPORT_RECEIPT } from '@adili/events/contracts';
import { z } from 'zod';

import { LETTER_STYLES, letterMeta, restrictedVerifyNote } from './letter.js';
import {
  DECLARATION_DOCUMENT_STYLES,
  EACC_ISSUER,
  esc,
  financialYearPeriod,
  formatDate,
  formatDateTime,
  htmlDocument,
  kenyanDate,
  letterhead,
  RULED_TABLE_STYLES,
  signatureNote,
  twoLineHash,
} from './page.js';
import { numberedBy, referenceOf } from './references.js';
import { sha256Schema } from '../sha256.js';
import type { DocumentTemplate } from './template.js';

const DAY_MS = 86_400_000;

/** A cross-field check runs once each of `fields` is valid, so a bad field is reported once. */
function validFields(...fields: string[]) {
  return (payload: { issues: readonly { path?: readonly PropertyKey[] }[] }) =>
    payload.issues.every((issue) => !fields.includes(String(issue.path?.[0])));
}

/**
 * What the reporting service sends for the signed acknowledgement of receipt of a submitted
 * compliance report: its reference, the SHA-256 of the `form-m.v1` document as received (canonical
 * JSON), the time of receipt and the Commission. No officer is named.
 */
export const complianceReportReceiptPayload = z
  .strictObject({
    reference: referenceOf(RPT),
    sha256: sha256Schema,
    submittedAt: z.iso.datetime({ offset: true }),
    commissionName: z.string().trim().min(1).max(200),
    /** The Commission's issuer code, as in the reference numbers (`PSC`). */
    issuerCode: z.string().regex(/^[A-Z0-9]{2,20}$/),
    /** `2027/2028`. */
    financialYear: z
      .string()
      .refine(
        (label) =>
          /^\d{4}\/\d{4}$/.test(label) && Number(label.slice(5)) === Number(label.slice(0, 4)) + 1,
        { message: 'Must be a financial year such as 2027/2028' },
      ),
    /** 31 July after the financial year, `YYYY-MM-DD`. */
    dueDate: z.iso.date(),
    /** Received after the due date (Nairobi time). */
    late: z.boolean(),
    /** Filed through Adili Online, or from the Commission's own system through the API. */
    source: z.enum(['hosted', 'federated']),
  })
  .refine((payload) => numberedBy(payload.reference, RPT, payload.issuerCode), {
    message: "The RPT reference number is not the Commission's",
    path: ['reference'],
  })
  .refine((payload) => payload.dueDate === `${payload.financialYear.slice(5)}-07-31`, {
    message: 'Must be 31 July after the financial year (Regs r.25(2))',
    path: ['dueDate'],
    when: validFields('financialYear', 'dueDate'),
  })
  // Late when received after the due date in Nairobi, as the reporting service decides it: a
  // signed receipt never says "On time" for a late report, or the reverse.
  .refine((payload) => payload.late === kenyanDate(payload.submittedAt) > payload.dueDate, {
    message: 'Must say whether the report was received after the due date (Nairobi time)',
    path: ['late'],
    when: validFields('submittedAt', 'dueDate', 'late'),
  })
  .meta({
    description:
      "Payload of compliance-report-receipt v1: the submitted report's RPT reference, the SHA-256 of its form-m.v1 document as received, the time of receipt, the Commission and the financial year with its due date and whether the report was late. Sent by the reporting service",
  });

export type ComplianceReportReceiptPayload = z.infer<typeof complianceReportReceiptPayload>;

const STYLES = `${LETTER_STYLES}${DECLARATION_DOCUMENT_STYLES}${RULED_TABLE_STYLES}
.doc-h{margin:6mm 0 2mm}
.skv{margin:4mm 0}
.skv dd{overflow-wrap:anywhere}
.hashc{font-size:7.6pt}
.late{display:inline-block;padding:0 1.6mm;margin-right:1.4mm;border-radius:0.8mm;background:#fdeceb;color:#b3241a;font-weight:700;font-size:8pt}
.signed{display:flex;justify-content:flex-end;margin-top:6mm;break-inside:avoid}`;

/** On time, or late with how many days after the due date it was received. */
function filing(payload: ComplianceReportReceiptPayload): string {
  if (!payload.late) return 'On time';
  const days = Math.round(
    (Date.parse(kenyanDate(payload.submittedAt)) - Date.parse(payload.dueDate)) / DAY_MS,
  );
  const after = days > 0 ? `Received ${days} day${days === 1 ? '' : 's'} after the deadline` : '';
  return `<span class="late">LATE</span>${esc(after || 'Received after the deadline')}`;
}

/**
 * The signed acknowledgement of receipt of a Commission's compliance report (Form M, Regs
 * r.25(2), spec 09): EACC's receipt with the report's reference, the SHA-256 of the report as
 * received and the time of receipt, issued when the report is submitted, hosted or federated.
 * Restricted: the verify page shows reference, type, issuer and date only.
 */
export const complianceReportReceiptV1: DocumentTemplate<ComplianceReportReceiptPayload> = {
  type: COMPLIANCE_REPORT_RECEIPT,
  version: 1,
  disclosureLevel: 'restricted',
  requires: { subjectPerson: 'refused' },
  title: 'Acknowledgement of receipt (Form M)',
  payload: complianceReportReceiptPayload,

  reference(payload) {
    return payload.reference;
  },

  subjectVersion() {
    return null;
  },

  publicPayload(payload, { issuedAt }) {
    return {
      type: COMPLIANCE_REPORT_RECEIPT,
      issuerName: EACC_ISSUER.name,
      issuerCode: EACC_ISSUER.code,
      issuedAt: issuedAt.toISOString(),
      reference: payload.reference,
      version: null,
    };
  },

  footer(payload) {
    return {
      issuerName: EACC_ISSUER.name,
      reference: payload.reference,
      version: null,
      mark: 'RESTRICTED',
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const reference = esc(payload.reference);
    const filedThrough =
      payload.source === 'federated'
        ? "From the Commission's own system through the Adili Online API"
        : 'Through Adili Online';
    const body = `${letterhead(EACC_ISSUER)}
<div class="doc-h"><div class="t1" role="heading" aria-level="1">Acknowledgement of receipt</div><div class="doc-sub">Compliance report (Form M) under regulation 25(2)</div></div>
${letterMeta(`<b>The Accounting Officer</b><br />${esc(payload.commissionName)}`, [
  ['Ref', `<span class="mono nw">${reference}</span>`],
  ['Date', `<span class="nw">${esc(formatDate(issuedAt))}</span>`],
])}
<dl class="skv">
<dt>Responsible Commission</dt><dd>${esc(payload.commissionName)} (${esc(payload.issuerCode)})</dd>
<dt>Report</dt><dd>Form M, financial year ${esc(payload.financialYear)} (${esc(financialYearPeriod(payload.financialYear))})</dd>
<dt>Reference</dt><dd class="mono">${reference}</dd>
<dt>Received</dt><dd>${esc(formatDateTime(payload.submittedAt))}</dd>
<dt>Deadline</dt><dd>${esc(formatDate(payload.dueDate))}</dd>
<dt>Filing</dt><dd>${filing(payload)}</dd>
<dt>Submitted</dt><dd>${esc(filedThrough)}</dd>
<dt>Content hash</dt><dd>${twoLineHash(payload.sha256)}<span class="fine" style="display:block;margin-top:1mm">SHA-256 of the form-m.v1 document as received</span></dd>
</dl>
<section class="close">
<p>The Ethics and Anti-Corruption Commission acknowledges receipt of the compliance report above. The hash identifies the exact content received; any change to the report would change it.</p>
<p class="fine">This receipt confirms the time of receipt and the content received. It does not confirm that the report is complete or correct.</p>
${restrictedVerifyNote(verificationId, 'receipt')}
<div class="signed">${signatureNote(signerName, issuedAt)}</div>
</section>`;
    return htmlDocument(`Acknowledgement of receipt ${payload.reference}`, STYLES, body);
  },
};
