import { NCR } from '@adili/numbering/references';
import { NATIONAL_CONSOLIDATED_REPORT } from '@adili/events/contracts';
import { z } from 'zod';

import {
  EACC_ISSUER,
  esc,
  financialYearPeriod,
  formatCount,
  formatDate,
  htmlDocument,
  LETTERHEAD_STYLES,
  letterhead,
  LINE,
  MUTED,
  signatureNote,
  SOFT,
} from './page.js';
import { restrictedVerifyNote } from './letter.js';
import { numberedBy, referenceOf } from './references.js';
import type { DocumentTemplate, RenderContext } from './template.js';

/** Rates below this are printed in red, as on EACC's intake. */
const LOW_RATE = 0.8;

const count = z.int().min(0);
/** declared / expected, 0 to 1; null when none were expected. */
const rate = z.number().min(0).max(1).nullable();

const section = z.strictObject({ expected: count, declared: count, notDeclared: count, rate });
const access = z.strictObject({ received: count, granted: count, declined: count });

/** reporting's `IntakeStatus`. */
const STATUSES = ['not-reported', 'submitted-on-time', 'submitted-late'] as const;

/**
 * The national report's numbers as reporting builds them (`NationalAggregates`): counts and rates
 * per Form M section, the year's reporting, and a row per Commission. Never an officer. Strict, so
 * a field reporting adds fails the issue until the template prints it.
 */
const aggregatesSchema = z.strictObject({
  /** The financial year's start year; the payload's `financialYear` is what the report prints. */
  fy: z.int(),
  reporting: z.strictObject({
    commissions: count,
    reported: count,
    onTime: count,
    late: count,
    notReported: count,
    rate,
  }),
  national: z.strictObject({
    initial: section,
    biennial: section,
    final: section,
    all: section,
    clarifications: count,
    accessRequests: access,
  }),
  byCommission: z.record(
    z.string().min(1).max(20),
    z.strictObject({
      name: z.string().trim().min(1).max(200),
      status: z.enum(STATUSES),
      /** The Commission's report in the reporting service; not printed. */
      reportId: z.uuid().nullable(),
      reference: z.string().max(60).nullable(),
      submittedAt: z.iso.datetime({ offset: true }).nullable(),
      initial: section.nullable(),
      biennial: section.extend({ noCycleInPeriod: z.boolean() }).nullable(),
      final: section.nullable(),
      /** Form M section 4: clarifications sought; null until the Commission reports. */
      clarifications: count.nullable(),
      /** Form M section 5: requests for access to information; null until it reports. */
      accessRequests: access.nullable(),
    }),
  ),
});

/**
 * What the reporting service sends for the approved national consolidated report: its `NCR`
 * reference, the year, when it was built and from how many reports, the aggregates, the
 * narrative sections the analyst wrote, and who wrote and approved it.
 */
export const ncrPayload = z
  .strictObject({
    reference: referenceOf(NCR),
    /** `2027/2028`. */
    financialYear: z.string().regex(/^\d{4}\/\d{4}$/),
    builtAt: z.iso.datetime({ offset: true }),
    reportsIncluded: count,
    aggregates: aggregatesSchema,
    /**
     * Each section's text, paragraphs separated by a blank line; empty when not written. As long
     * as reporting's `updateNationalReportNarrative` accepts.
     */
    narrative: z.strictObject({
      overview: z.string().max(20_000),
      findings: z.string().max(40_000),
      recommendations: z.string().max(20_000),
    }),
    author: z.string().trim().min(1).max(200),
    approver: z.string().trim().min(1).max(200),
    approvedAt: z.iso.datetime({ offset: true }),
  })
  .refine((payload) => numberedBy(payload.reference, NCR, EACC_ISSUER.code), {
    message: "The NCR reference number is not EACC's",
    path: ['reference'],
  })
  .meta({
    description:
      "Payload of ncr v1: the approved national consolidated report's NCR reference, financial year, build time and reports included, the aggregates reporting built (`reporting`, `national` and `byCommission`; counts and rates only), the narrative sections, the author and the approver. Sent by the reporting service",
  });

export type NcrPayload = z.infer<typeof ncrPayload>;
type Section = z.infer<typeof section>;

const STYLES = `${LETTERHEAD_STYLES}
body{font-size:9pt;line-height:1.5}
p{margin:0 0 2.6mm}
h2{font-size:11pt;font-weight:700;margin:6mm 0 2.5mm;break-after:avoid}
.fine{font-size:8pt;color:${SOFT}}
.cover-h{margin:16mm 0 8mm}
.cover-h .ey{font-size:8pt;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#b8430f}
.cover-h .t1{font-size:24pt;font-weight:800;line-height:1.1;letter-spacing:-0.015em;margin:3mm 0}
.cover-h .sub{font-size:11pt;color:${SOFT}}
.rtiles{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;margin:6mm 0}
.rtile{padding:4mm;border-radius:2mm;background:#f6f5f3}
.rtile .k{font-size:7.6pt;color:${SOFT};font-weight:600}
.rtile .v{font-size:17pt;font-weight:800;letter-spacing:-0.01em;margin-top:1mm}
.rtile .s{font-size:7.6pt;color:${MUTED}}
.appr{display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-top:6mm;padding-top:4mm;border-top:0.25mm solid ${LINE}}
.appr .k{font-size:7.6pt;color:${MUTED};font-weight:600;text-transform:uppercase;letter-spacing:0.06em}
.appr .v{font-weight:600;margin-top:0.6mm}
.body{break-before:page}
.narr p{white-space:pre-line;overflow-wrap:anywhere}
.empty{color:${MUTED};font-style:italic}
.rt{width:100%;border-collapse:collapse;font-size:8.6pt;margin:2mm 0 4mm}
.rt th,.rt td{padding:2mm 1.6mm;border-bottom:0.25mm solid ${LINE};text-align:left;vertical-align:top}
.rt tr{break-inside:avoid}
.rt th{font-size:7.4pt;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em;border-bottom:0.35mm solid #1a1a1a}
.rt .num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.rt tfoot td{font-weight:700;border-top:0.35mm solid #1a1a1a;border-bottom:0}
.rt.dense{font-size:7.4pt}
.rt.dense td{padding:1.25mm 1.4mm}
.rt .sub{display:block;color:#8a8985;font-size:6.6pt}
.rt th.wrap{white-space:normal}
.rt .ref{display:block;white-space:nowrap}
.rbar{height:2mm;border-radius:1mm;background:#ecebe8;overflow:hidden;margin-top:1mm}
.rbar i{display:block;height:100%;background:#1a1a1a}
.rbar.low i{background:#c9291e}
.low-rate{color:#b3241a;font-weight:700}
.st-late{color:#b3241a;font-weight:600}
.st-nr{color:#8a8985}
.annex{break-before:page}
.signed{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;margin-top:8mm;break-inside:avoid}
.signed p{margin:0;flex:1}
.signed .sigbox{flex:none}`;

/** `95.0%`; `-` when none were expected. */
function percent(value: number | null): string {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

const isLow = (value: number | null) => value !== null && value < LOW_RATE;

/** A narrative section's paragraphs, or a note that it was left empty. */
function narrative(text: string): string {
  const paragraphs = text
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
  if (paragraphs.length === 0) return '<p class="empty">No text for this section.</p>';
  return paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join('');
}

function cover(payload: NcrPayload, context: RenderContext): string {
  const { reporting, national } = payload.aggregates;
  return `<div class="cover-h"><div class="ey">Financial year ${esc(payload.financialYear)}</div><div class="t1" role="heading" aria-level="1">National Consolidated Report</div><div class="sub">Compliance with the declaration of income, assets and liabilities by Responsible Commissions, ${esc(financialYearPeriod(payload.financialYear))}</div></div>
<div class="rtiles">
<div class="rtile"><div class="k">Commissions reporting</div><div class="v">${formatCount(reporting.reported)} of ${formatCount(reporting.commissions)}</div><div class="s">${formatCount(reporting.onTime)} on time · ${formatCount(reporting.late)} late · ${formatCount(reporting.notReported)} not reported</div></div>
<div class="rtile"><div class="k">Declared rate, all sections</div><div class="v">${percent(national.all.rate)}</div><div class="s">${formatCount(national.all.declared)} of ${formatCount(national.all.expected)} officers</div></div>
<div class="rtile"><div class="k">Did not declare</div><div class="v">${formatCount(national.all.notDeclared)}</div><div class="s">Across reporting Commissions</div></div>
</div>
<div class="appr">
<div><div class="k">Prepared by</div><div class="v">${esc(payload.author)}, EACC analyst</div><div class="fine">Built ${esc(formatDate(payload.builtAt))} from ${formatCount(payload.reportsIncluded)} submitted report${payload.reportsIncluded === 1 ? '' : 's'}</div></div>
<div><div class="k">Approved by</div><div class="v">${esc(payload.approver)}, EACC supervisor</div><div class="fine">On ${esc(formatDate(payload.approvedAt))}</div></div>
</div>
<div class="signed">${restrictedVerifyNote(context.verificationId, 'report')}${signatureNote(context.signerName, context.issuedAt)}</div>`;
}

function rateCell(each: Section): string {
  return `<td class="num">${percent(each.rate)}<div class="rbar${isLow(each.rate) ? ' low' : ''}"><i style="width:${each.rate === null ? 0 : Math.min(100, each.rate * 100).toFixed(1)}%"></i></div></td>`;
}

function nationalTotals(payload: NcrPayload): string {
  const { national, reporting } = payload.aggregates;
  const rows: [string, Section][] = [
    ['1. Initial declarations', national.initial],
    ['2. Biennial declarations', national.biennial],
    ['3. Final declarations', national.final],
  ];
  const body = rows
    .map(
      ([label, each]) =>
        `<tr><td>${esc(label)}</td><td class="num">${formatCount(each.expected)}</td><td class="num">${formatCount(each.declared)}</td><td class="num">${formatCount(each.notDeclared)}</td>${rateCell(each)}</tr>`,
    )
    .join('');
  const share = (n: number) =>
    percent(reporting.commissions > 0 ? n / reporting.commissions : null);
  const due = `${Number(payload.financialYear.slice(5))}-07-31`;
  return `<h2>2. National totals</h2>
<table class="rt"><caption class="fine" style="text-align:left;caption-side:bottom;padding-top:1mm">Expected and declared officers per Form M section, as filed.</caption><thead><tr><th>Form M section</th><th class="num">Expected</th><th class="num">Declared</th><th class="num">Did not declare</th><th class="num" style="width:34mm">Rate</th></tr></thead>
<tbody>${body}</tbody>
<tfoot><tr><td>All sections</td><td class="num">${formatCount(national.all.expected)}</td><td class="num">${formatCount(national.all.declared)}</td><td class="num">${formatCount(national.all.notDeclared)}</td><td class="num">${percent(national.all.rate)}</td></tr></tfoot></table>
<table class="rt"><thead><tr><th>Other Form M sections</th><th class="num">Total</th></tr></thead><tbody>
<tr><td>4. Clarifications sought</td><td class="num">${formatCount(national.clarifications)}</td></tr>
<tr><td>5. Requests for access to information received</td><td class="num">${formatCount(national.accessRequests.received)}</td></tr>
<tr><td>5. Requests granted</td><td class="num">${formatCount(national.accessRequests.granted)}</td></tr>
<tr><td>5. Requests declined</td><td class="num">${formatCount(national.accessRequests.declined)}</td></tr>
</tbody></table>
<table class="rt"><thead><tr><th>Reporting status</th><th class="num">Commissions</th><th class="num">Share</th></tr></thead><tbody>
<tr><td>Reported by ${esc(formatDate(due))}</td><td class="num">${formatCount(reporting.onTime)}</td><td class="num">${share(reporting.onTime)}</td></tr>
<tr><td>Reported late</td><td class="num">${formatCount(reporting.late)}</td><td class="num">${share(reporting.late)}</td></tr>
<tr><td>Not reported when this report was built</td><td class="num">${formatCount(reporting.notReported)}</td><td class="num">${share(reporting.notReported)}</td></tr>
</tbody></table>`;
}

const STATUS_CELL: Record<(typeof STATUSES)[number], string> = {
  'submitted-on-time': '<span>On time</span>',
  'submitted-late': '<span class="st-late">Late</span>',
  'not-reported': '<span class="st-nr">Not reported</span>',
};

function sectionCell(each: Section | null): string {
  if (each === null) return '<td class="num">-</td>';
  return `<td class="num"><span class="${isLow(each.rate) ? 'low-rate' : ''}">${percent(each.rate)}</span><span class="sub">${formatCount(each.declared)} / ${formatCount(each.expected)}</span></td>`;
}

function accessCell(each: z.infer<typeof access> | null): string {
  if (each === null) return '<td class="num">-</td>';
  return `<td class="num">${formatCount(each.received)}<span class="sub">${formatCount(each.granted)} granted · ${formatCount(each.declined)} declined</span></td>`;
}

function annex(payload: NcrPayload): string {
  const rows = Object.entries(payload.aggregates.byCommission)
    .map(
      ([slug, row], index) =>
        `<tr><td>${index + 1}</td><td><b>${esc(row.name)}</b><span class="sub">${esc(slug.toUpperCase())}${row.reference ? `<span class="mono ref">${esc(row.reference)}</span>` : ''}</span></td><td>${STATUS_CELL[row.status]}</td><td class="nw">${row.submittedAt ? esc(formatDate(row.submittedAt)) : '-'}</td>${sectionCell(row.initial)}${sectionCell(row.biennial)}${sectionCell(row.final)}<td class="num">${row.clarifications === null ? '-' : formatCount(row.clarifications)}</td>${accessCell(row.accessRequests)}</tr>`,
    )
    .join('');
  return `<section class="annex"><h2>Annex. Results by Commission</h2>
<p class="fine">Declared / expected officers per Form M section, as filed, with the clarifications sought (section 4) and the requests for access to information received (section 5). Rates below ${percent(LOW_RATE)} are in red.</p>
<table class="rt dense"><thead><tr><th style="width:6mm">No</th><th>Commission</th><th>Status</th><th>Received</th><th class="num">Initial</th><th class="num">Biennial</th><th class="num">Final</th><th class="num wrap">Clarifications</th><th class="num wrap">Access requests</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="empty">No Commissions</td></tr>'}</tbody></table></section>`;
}

/**
 * EACC's national consolidated report (spec 09, Act s.6): the year's compliance reports
 * consolidated, built by an EACC analyst from the reports as filed and approved by an EACC
 * supervisor. The cover with the headline numbers and who prepared and approved it, the
 * narrative (overview, findings, recommendations), the national totals per Form M section and
 * the reporting status, and an annex with each Commission's results. Restricted: the verify page
 * shows reference, type, issuer and date only.
 */
export const ncrV1: DocumentTemplate<NcrPayload> = {
  type: NATIONAL_CONSOLIDATED_REPORT,
  version: 1,
  disclosureLevel: 'restricted',
  requires: { subjectPerson: 'refused' },
  title: 'National consolidated report',
  payload: ncrPayload,

  reference(payload) {
    return payload.reference;
  },

  subjectVersion() {
    return null;
  },

  publicPayload(payload, { issuedAt }) {
    return {
      type: NATIONAL_CONSOLIDATED_REPORT,
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

  render(payload, context) {
    const body = `${letterhead(EACC_ISSUER)}
${cover(payload, context)}
<section class="body">
<h2 style="margin-top:0">1. Overview</h2>
<div class="narr">${narrative(payload.narrative.overview)}</div>
<p class="fine">Figures are taken from the reports as filed. EACC does not see individual declarations.</p>
${nationalTotals(payload)}
<h2>3. Findings</h2>
<div class="narr">${narrative(payload.narrative.findings)}</div>
<h2>4. Recommendations</h2>
<div class="narr">${narrative(payload.narrative.recommendations)}</div>
</section>
${annex(payload)}`;
    return htmlDocument(`National consolidated report ${payload.reference}`, STYLES, body);
  },
};
