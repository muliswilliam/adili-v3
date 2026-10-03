import { RPT } from '@adili/numbering/references';
import { FORM_M } from '@adili/events/contracts';
import { FormMSchema, type FormMV1, REPORT_SOURCES } from '@adili/forms';
import { z } from 'zod';

import {
  ACCENT,
  esc,
  formatCount,
  formatDate,
  formatDateTime,
  htmlDocument,
  LETTERHEAD_STYLES,
  letterhead,
  LINE,
  MUTED,
  reportDueDate,
  RULED_TABLE_STYLES,
  signatureNote,
  SOFT,
} from './page.js';
import { restrictedVerifyNote } from './letter.js';
import { numberedBy, referenceOf } from './references.js';
import type { DocumentTemplate } from './template.js';

/**
 * The payload of form-m v1: the Commission's compliance report as filed, the `form-m.v1`
 * document itself (packages/schemas/forms/form-m.v1.json), with the `RPT` reference allocated
 * on submission in its `meta`. The reporting service sends it in the issue request when the
 * report is submitted; the names it lists live in the PDF and the report snapshot only.
 */
export const formMPayload = FormMSchema.extend({
  meta: z.strictObject({
    compiledAt: z.iso.datetime({ offset: true }).optional(),
    /** Allocated when the report is submitted. */
    reference: referenceOf(RPT),
    source: z.enum(REPORT_SOURCES).optional(),
  }),
})
  .refine((document) => numberedBy(document.meta.reference, RPT, document.partI.issuerCode), {
    message: "The RPT reference number is not the Commission's",
    path: ['meta', 'reference'],
  })
  .meta({
    description:
      'Payload of form-m v1: the submitted `form-m.v1` document as filed (FormMV1), with its RPT reference in `meta.reference`. Sent by the reporting service; the template prints every part of the prescribed form',
  });

export type FormMPayload = z.infer<typeof formMPayload>;

/** form-m.v1 `NonFilerRow.actionTaken`, as the form prints it. */
const ACTION_TAKEN: Record<
  FormMV1['partII']['initial']['nonFilers'][number]['actionTaken'],
  string
> = {
  none: 'No action taken',
  'notice-to-comply': 'Notice to comply',
  warning: 'Warning',
  'salary-stoppage': 'Salary stoppage',
  'disciplinary-referral': 'Disciplinary referral',
  'referred-to-eacc': 'Referred to EACC',
};

const COMPLIED: Record<FormMV1['partII']['initial']['nonFilers'][number]['complied'], string> = {
  yes: 'Yes',
  no: 'No',
  pending: 'Pending',
};

const CLARIFICATION_STATUS: Record<
  FormMV1['partII']['clarifications']['items'][number]['statusOfCompliance'],
  string
> = {
  responded: 'Responded',
  resolved: 'Resolved',
  pending: 'Pending',
  overdue: 'Overdue',
  withdrawn: 'Withdrawn',
};

/** Regs r.24 grounds for declining access, as the access officer's decision names them. */
const DECLINE_REASON: Record<
  FormMV1['partII']['accessRequests']['declineReasons'][number]['reason'],
  string
> = {
  'public-interest': 'Against the public interest (r. 24(a))',
  'prejudice-proceeding': 'May prejudice an ongoing proceeding or investigation (r. 24(b))',
  'frivolous-vexatious': 'Frivolous, vexatious or scandalous (r. 24(c))',
  'not-objectives': 'Does not promote the objectives of the Act (r. 24(d))',
  other: 'Other',
};

const STYLES = `${LETTERHEAD_STYLES}${RULED_TABLE_STYLES}
body{font-size:8.8pt;line-height:1.45}
p{margin:0 0 2mm}
.fine{font-size:8.2pt;color:${SOFT}}
.fm-top{display:flex;justify-content:space-between;align-items:baseline;margin-top:5mm}
.fm-form{font-size:13pt;font-weight:800;letter-spacing:0.08em}
.fm-reg{font-size:9pt}
.fm-title{text-align:center;font-size:11.5pt;font-weight:800;letter-spacing:0.04em;margin:3mm 0 2mm}
.fm-meta{display:flex;justify-content:center;gap:2mm 5mm;flex-wrap:wrap;font-size:7.8pt;color:${SOFT};padding:2mm 0;border-top:0.25mm solid ${LINE};border-bottom:0.25mm solid ${LINE}}
.fm-part{font-size:9.6pt;font-weight:800;letter-spacing:0.02em;margin:5mm 0 2mm;padding:1.4mm 2.5mm;background:#f1f0ed;break-after:avoid}
.fm-sec{font-weight:700;margin:4mm 0 0.5mm;break-after:avoid}
.fm-note{font-size:8pt;color:${SOFT};font-style:italic;margin:0 0 1.5mm}
.fm-d{margin:1.5mm 0 1mm}
.fl{display:grid;grid-template-columns:1fr 26mm;gap:4mm;align-items:end;padding:1.1mm 0;border-bottom:0.25mm dotted #9a9894;break-inside:avoid}
.fl .val{text-align:right;font-weight:700}
.fl.wide{grid-template-columns:74mm 1fr}
.fl.wide .val{text-align:left;overflow-wrap:anywhere}
.nc{color:#9a9894;font-weight:400;font-style:italic}
.box{display:inline-block;width:3.2mm;height:3.2mm;border:0.3mm solid #1a1a1a;vertical-align:middle;margin:0 1mm 0 3mm;text-align:center;line-height:2.6mm;overflow:hidden;font-size:7pt;font-weight:800}
.marker{margin:1mm 0 2mm;padding:2mm 3mm;border-left:0.9mm solid ${ACCENT};background:#fdf4ee;font-size:8.2pt}
.record{margin:5mm 0 3mm;padding:3mm 4mm;border-radius:1.6mm;background:#f6f5f3;font-size:8pt;break-inside:avoid}
.record .h{font-weight:700;margin-bottom:1.5mm}
.record dl{display:grid;grid-template-columns:34mm 1fr;gap:0.8mm 3mm;margin:0}
.record dt{color:${MUTED}}
.record dd{margin:0;overflow-wrap:anywhere}
.sign-off{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;margin-top:3mm;break-inside:avoid}`;

/** A value of the form, or "Not completed" when the Commission left it empty. */
function value(text: string | null | undefined): string {
  return text === null || text === undefined || text.trim() === ''
    ? '<span class="nc">Not completed</span>'
    : esc(text);
}

/** A form line: the prescribed wording on the left, the Commission's entry on the right. */
function line(label: string, entry: string, wide = false): string {
  return `<div class="fl${wide ? ' wide' : ''}"><span>${esc(label)}</span><span class="val">${entry}</span></div>`;
}

/**
 * A staff, file, ID or passport number: kept on one line when it is as short as such numbers are
 * (`PF-2027-000341`), so a narrow column does not break it at a hyphen.
 */
function identifierCell(identifier: string): string {
  return `<td class="mono${identifier.length <= 20 ? ' nw' : ''}">${esc(identifier)}</td>`;
}

type Section = FormMV1['partII']['initial'];

/** Counts (a)-(c) of sections 1-3 in the form's wording. */
function counts(section: Section, labels: readonly [string, string, string]): string {
  return [
    line(labels[0], formatCount(section.expected)),
    line(labels[1], formatCount(section.declared)),
    line(labels[2], formatCount(section.notDeclared)),
  ].join('');
}

/** The list (d) of officers who did not declare, with the action taken and whether they complied. */
function nonFilers(section: Section, caption: string, dateHeading: string): string {
  const rows = section.nonFilers.length
    ? section.nonFilers
        .map(
          (row, index) =>
            `<tr><td class="n">${index + 1}.</td><td>${esc(row.name)}</td><td>${esc(row.designation)}</td>${identifierCell(row.identifier)}<td class="nw">${esc(formatDate(row.date))}</td><td><b>${esc(ACTION_TAKEN[row.actionTaken])}</b> · Complied: ${esc(COMPLIED[row.complied])}${row.remarks ? `<span class="sub">${esc(row.remarks)}</span>` : ''}</td></tr>`,
        )
        .join('')
    : '<tr class="none"><td colspan="6">None</td></tr>';
  return `<table class="ft"><caption>${esc(caption)}</caption><thead><tr><th class="n">No.</th><th>Name</th><th>Designation</th><th>Staff/File/ID Passport No.</th><th>${esc(dateHeading)}</th><th style="width:44mm">Action taken / Remarks</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function descriptionPart(document: FormMV1): string {
  const { partI } = document;
  return `<h2 class="fm-part">PART I: DESCRIPTION OF THE RESPONSIBLE COMMISSION</h2>
${line('(i) Name of the Responsible Commission:', value(partI.commissionName), true)}
${line('(ii) Contact details:', value(partI.contactDetails), true)}
${line('(iii) Physical address:', value(partI.physicalAddress), true)}
${line('(iv) Email address:', value(partI.emailAddress), true)}
${line('(v) Period for which the compliance report is made:', `${esc(formatDate(partI.period.from))} to ${esc(formatDate(partI.period.to))}`, true)}`;
}

function declarationSections(document: FormMV1): string {
  const { initial, biennial, final } = document.partII;
  const noCycle = biennial.noCycleInPeriod
    ? '<div class="marker">No biennial declaration fell due in this financial year: its period holds no biennial statement date.</div>'
    : '';
  return `<h2 class="fm-part">PART II: DECLARATION OF INCOME, ASSETS AND LIABILITIES</h2>
<div class="fm-sec">1. Submission of initial declaration of income, assets and liabilities.</div>
<p class="fm-note">(an initial declaration is required to be made by a public officer within thirty (30) days upon appointment or election to a public office)</p>
${counts(initial, [
  '(a) Number of public officers appointed within the reporting period (newly appointed officers)',
  '(b) Number of newly appointed public officers who made an initial declaration',
  '(c) Number of newly appointed public officers who did not make an initial declaration',
])}
<p class="fm-d">(d) Provide a list of newly appointed officers who did not make an initial declaration. Indicate whether any action was taken and whether the officer(s) complied.</p>
${nonFilers(initial, 'List of officers who did not submit initial declaration of income, assets and liabilities', 'Date of appointment')}
<div class="fm-sec">2. Submission of biennial declaration of income, assets and liabilities.</div>
<p class="fm-note">(a biennial declaration is required to be made by a public officer once every two years within the period of service as a public officer)</p>
${noCycle}
${counts(biennial, [
  '(a) Number of public officers in the reporting entity within the reporting period',
  '(b) Number of public officers in the reporting entity who made a biennial declaration',
  '(c) Number of public officers in the reporting entity who did not make a biennial declaration',
])}
<p class="fm-d">(d) Provide a list of officers who did not make a biennial declaration. Indicate whether any action was taken and whether the officer(s) complied.</p>
${nonFilers(biennial, 'List of officers who did not submit biennial declaration of income, assets and liabilities', 'Date of appointment')}
<div class="fm-sec">3. Submission of final declaration of income, assets and liabilities.</div>
<p class="fm-note">(a final declaration is required to be made by a public officer within thirty (30) days upon ceasing to hold a public office)</p>
${counts(final, [
  '(a) Number of public officers in the reporting entity who ceased to be public officers within the reporting period',
  '(b) Number of officers who made a final declaration',
  '(c) Number of officers who did not make a final declaration',
])}
<p class="fm-d">(d) Provide a list of officers who exited your entity and did not make a final declaration within 30 days upon exiting. Indicate whether any action was taken and whether the officer(s) complied.</p>
${nonFilers(final, 'List of public officers who did not submit final declaration of income, assets and liabilities', 'Date of exit')}`;
}

function clarificationsSection(document: FormMV1): string {
  const { items } = document.partII.clarifications;
  const rows = items.length
    ? items
        .map(
          (item, index) =>
            `<tr><td class="n">${index + 1}.</td><td>${esc(item.name)}</td><td>${esc(item.designation)}</td>${identifierCell(item.identifier)}<td>${esc(item.natureInGeneralTerms)}${item.clarificationReference ? `<span class="sub mono">${esc(item.clarificationReference)}</span>` : ''}</td><td>${esc(CLARIFICATION_STATUS[item.statusOfCompliance])}</td></tr>`,
        )
        .join('')
    : '<tr class="none"><td colspan="6">None</td></tr>';
  return `<div class="fm-sec">4. Clarifications sought from public officers who made an initial, biennial or final declaration (s. 33)</div>
<table class="ft"><caption>List of public officers from whom clarification was sought and status of compliance</caption><thead><tr><th class="n">No.</th><th>Name</th><th>Designation</th><th>Staff/File/ID Passport No.</th><th>Nature of Clarification Sought (state in general terms)</th><th>Status of Compliance</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** `(r. 24(b))` on one line, so a reason never breaks inside its citation. */
function regulationKeptWhole(html: string): string {
  return html.replace(/\(r\. \d+\([a-z]\)\)/g, (cite) => `<span class="nw">${cite}</span>`);
}

function accessSection(document: FormMV1): string {
  const access = document.partII.accessRequests;
  const reasons = access.declineReasons.length
    ? access.declineReasons
        .map(
          (each) =>
            `${regulationKeptWhole(esc(DECLINE_REASON[each.reason]))}: ${formatCount(each.count)}`,
        )
        .join('<br />')
    : 'None';
  const unavailable = access.dataUnavailable
    ? '<p class="fine">Note: Access request data is not yet captured on Adili.</p>'
    : '';
  return `<div class="fm-sec">5. Access to information in a declaration of income assets and liabilities or a clarification.</div>
<p class="fm-note">(A person may, for purposes of section 36 of the Act, apply to the responsible commission to access information contained in a declaration or clarification made under the Act)</p>
${line('(a) Number of requests for access to information received', formatCount(access.received))}
${line('(b) Number of requests for access to information granted', formatCount(access.granted))}
${line('(c) Number of requests for access to information declined', formatCount(access.declined))}
${line('(d) Reasons for declining requests for access to information:', reasons, true)}
${unavailable}`;
}

function complaintsPart(document: FormMV1): string {
  const { registerMaintained, items } = document.partII.complaints;
  const tick = (on: boolean) => `<span class="box">${on ? '✓' : ''}</span>`;
  const register =
    registerMaintained === null
      ? '<span class="nc">Not completed</span>'
      : `Yes ${tick(registerMaintained)} No ${tick(!registerMaintained)}`;
  const empty =
    registerMaintained === null
      ? 'Not completed'
      : 'No complaints received in the reporting period (0)';
  const rows = items.length
    ? items
        .map(
          (item, index) =>
            `<tr><td class="n">${index + 1}.</td><td>${esc(item.name)}</td><td>${esc(item.designation)}</td>${identifierCell(item.identifier)}<td>${esc(item.nature)}</td><td>${esc(item.status)}</td></tr>`,
        )
        .join('')
    : `<tr class="none"><td colspan="6">${empty}</td></tr>`;
  return `<h2 class="fm-part">B. COMPLAINTS AND INVESTIGATIONS</h2>
<p>6. Does the responsible commission maintain a register of complaints on allegations of violation of the provisions of the Act?</p>
<p>${register}</p>
<p>7. Indicate the number of complaints received within the reporting period, and action taken:</p>
<table class="ft"><thead><tr><th class="n">No</th><th>Name</th><th>Designation</th><th>Staff/File/ID Passport No</th><th>Nature of complaint</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function authenticationPart(document: FormMV1, signature: string): string {
  const { compiledBy, confirmedBy } = document.partIII;
  const date = (text: string | null) => (text === null ? value(null) : esc(formatDate(text)));
  return `<h2 class="fm-part">PART III: AUTHENTICATION OF INFORMATION</h2>
${line('Compiled by:', value(compiledBy.name), true)}
${line('Designation:', value(compiledBy.designation), true)}
${line('Date:', date(compiledBy.date), true)}
${line('Confirmed by:', value(confirmedBy.name), true)}
${line('Designation:', value(confirmedBy.designation), true)}
${line('Date:', date(confirmedBy.date), true)}
<div class="sign-off"><b>Authorized Officer of the Responsible Commission</b>${signature}</div>`;
}

/** How the report reached EACC: the Commission's own system, or Adili Online. */
function filedThrough(document: FormMPayload): string {
  return document.meta.source === 'federated'
    ? "Submitted from the Commission's own system through the Adili Online API"
    : 'Filed through Adili Online';
}

/** What Adili Online adds below the prescribed form: the reference and how it was filed. */
function submissionRecord(document: FormMPayload, verificationId: string): string {
  const compiled = document.meta.compiledAt
    ? `<dt>Compiled</dt><dd>${esc(formatDateTime(document.meta.compiledAt))} from the Commission's roster, filings, clarifications and actions</dd>`
    : '';
  return `<div class="record"><div class="h">Submission record (added by Adili Online, not part of the prescribed form)</div><dl>
<dt>Reference</dt><dd class="mono">${esc(document.meta.reference)}</dd>
<dt>Filing</dt><dd>${esc(filedThrough(document))}</dd>
${compiled}
<dt>Receipt</dt><dd>EACC's signed acknowledgement of receipt carries the SHA-256 of this report as received and the time of receipt.</dd>
</dl></div>
${restrictedVerifyNote(verificationId, 'report')}`;
}

/**
 * Form M (Regs r.25(2)(a), spec 09): the Responsible Commission's compliance report to EACC for
 * a financial year as filed, every part of the prescribed form (Part I, Part II sections 1-5,
 * Part B complaints, Part III authentication) followed by Adili Online's submission record.
 * Issued when the report is submitted. Restricted: the verify page shows reference, type,
 * Commission and date only.
 */
export const formMV1: DocumentTemplate<FormMPayload> = {
  type: FORM_M,
  version: 1,
  disclosureLevel: 'restricted',
  requires: { subjectPerson: 'refused' },
  title: 'Form M compliance report',
  payload: formMPayload,

  reference(payload) {
    return payload.meta.reference;
  },

  subjectVersion() {
    return null;
  },

  publicPayload(payload, { issuedAt }) {
    return {
      type: FORM_M,
      issuerName: payload.partI.commissionName,
      issuerCode: payload.partI.issuerCode,
      issuedAt: issuedAt.toISOString(),
      reference: payload.meta.reference,
      version: null,
    };
  },

  footer(payload) {
    return {
      issuerName: payload.partI.commissionName,
      reference: payload.meta.reference,
      version: null,
      mark: 'RESTRICTED',
    };
  },

  render(payload, { verificationId, issuedAt, signerName }) {
    const { commissionName, issuerCode, period } = payload.partI;
    const fy = `${period.financialYearStart}/${period.financialYearStart + 1}`;
    const body = `${letterhead({ name: commissionName, code: issuerCode })}
<div class="fm-top"><div class="fm-form">FORM M</div><div class="fm-reg">(r. 25(2)(a))</div></div>
<div class="fm-title" role="heading" aria-level="1">COMPLIANCE REPORT BY A RESPONSIBLE COMMISSION</div>
<div class="fm-meta"><span>Ref <b class="mono">${esc(payload.meta.reference)}</b></span><span>Financial year ${esc(fy)}</span><span>Due ${esc(formatDate(reportDueDate(fy)))}</span><span>${esc(filedThrough(payload))}</span></div>
${descriptionPart(payload)}
${declarationSections(payload)}
${clarificationsSection(payload)}
${accessSection(payload)}
${complaintsPart(payload)}
${authenticationPart(payload, signatureNote(signerName, issuedAt))}
${submissionRecord(payload, verificationId)}`;
    return htmlDocument(`Form M ${payload.meta.reference}`, STYLES, body);
  },
};
