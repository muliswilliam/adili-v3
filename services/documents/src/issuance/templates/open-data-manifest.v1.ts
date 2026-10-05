import { NCR } from '@adili/numbering/references';
import { OPEN_DATA_MANIFEST } from '@adili/events/contracts';
import { z } from 'zod';

import { sha256Schema } from '../sha256.js';
import {
  DECLARATION_DOCUMENT_STYLES,
  EACC_ISSUER,
  esc,
  financialYearPeriod,
  formatCount,
  formatDate,
  formatDateTime,
  htmlDocument,
  LETTERHEAD_STYLES,
  letterhead,
  RULED_TABLE_STYLES,
  signatureNote,
  SOFT,
} from './page.js';
import { numberedBy, referenceOf } from './references.js';
import type { DocumentTemplate } from './template.js';

/**
 * The six tables of an open-data release (reporting.yaml `OpenDataTable`), in release order, with
 * the names the manifest prints.
 */
const TABLES = [
  ['filing-by-commission', 'Declarations by Commission'],
  ['compliance-by-commission', 'Compliance by Commission'],
  ['by-entity-type', 'By reporting entity type'],
  ['by-cycle', 'By cycle'],
  ['access-requests', 'Access requests'],
  ['national-totals', 'National totals'],
] as const;
const TABLE_NAMES = TABLES.map(([table]) => table) as [
  (typeof TABLES)[number][0],
  ...(typeof TABLES)[number][0][],
];
const TABLE_LABELS: Record<string, string> = Object.fromEntries(TABLES);

const count = z.int().min(0);

/** A table's two files: rows, cells hidden by suppression, and each file's SHA-256. */
const tableEntry = z.strictObject({
  table: z.enum(TABLE_NAMES),
  rows: count,
  /** Cells hidden by suppression (under the threshold, or complementary). */
  cellsSuppressed: count,
  sha256Json: sha256Schema,
  sha256Csv: sha256Schema,
});

/**
 * What the reporting service sends when an open-data release is published: the release's id,
 * year, kind and version, when it was built, the national consolidated report it reconciles with,
 * who published it (null when it published on the report's approval), the suppression threshold,
 * and each table's rows, hidden cells and file hashes, with the hash of the release JSON. No
 * figure: the files hold those.
 */
export const openDataManifestPayload = z
  .strictObject({
    releaseId: z.uuid(),
    /** `2027/2028`. */
    financialYear: z
      .string()
      .refine(
        (label) =>
          /^\d{4}\/\d{4}$/.test(label) && Number(label.slice(5)) === Number(label.slice(0, 4)) + 1,
        { message: 'Must be a financial year such as 2027/2028' },
      ),
    kind: z.enum(['annual', 'snapshot']),
    version: z.int().min(1),
    /** When the tables were built: the figures are as at then. */
    builtAt: z.iso.datetime({ offset: true }),
    /** The approved national consolidated report; null for a snapshot of a draft one. */
    ncrReference: referenceOf(NCR).nullable(),
    /** The EACC supervisor who published it; null when it published on the NCR's approval. */
    publishedBy: z.string().trim().min(1).max(200).nullable(),
    /** Cells over fewer officers than this are hidden. */
    suppressionThreshold: z.int().min(1),
    tables: z.array(tableEntry),
    /** SHA-256 of the release JSON (`release.json`). */
    releaseSha256: sha256Schema,
  })
  .refine(
    (payload) =>
      payload.tables.length === TABLES.length &&
      payload.tables.every((entry, index) => entry.table === TABLE_NAMES[index]),
    { message: 'Must list the six tables once each, in release order', path: ['tables'] },
  )
  .refine(
    (payload) => payload.ncrReference === null || numberedBy(payload.ncrReference, NCR, 'EACC'),
    { message: "The NCR reference number is not EACC's", path: ['ncrReference'] },
  )
  .refine((payload) => payload.kind !== 'annual' || payload.ncrReference !== null, {
    message: 'An annual release is of the approved national consolidated report',
    path: ['ncrReference'],
  })
  .refine((payload) => payload.publishedBy !== null || payload.ncrReference !== null, {
    message: 'Published on approval needs the approved report',
    path: ['publishedBy'],
  })
  .meta({
    description:
      "Payload of open-data-manifest v1: a published open-data release's id, financial year, kind and version, build time, the NCR reference it reconciles with (null for a snapshot of a draft), who published it (null when on the NCR's approval), the suppression threshold, and the six tables' rows, hidden cells and SHA-256 of their JSON and CSV files, with the SHA-256 of the release JSON. No figures. Sent by the reporting service",
  });

export type OpenDataManifestPayload = z.infer<typeof openDataManifestPayload>;

const KIND_NAMES: Record<OpenDataManifestPayload['kind'], string> = {
  annual: 'Annual release',
  snapshot: 'Mid-year snapshot',
};

const STYLES = `${LETTERHEAD_STYLES}${DECLARATION_DOCUMENT_STYLES}${RULED_TABLE_STYLES}
.doc-h{margin:5mm 0 3mm}
.skv{margin:3mm 0}
.skv dt,.skv dd{padding:1.1mm 0}
.skv dd .fine{display:block;margin-top:0.4mm;font-weight:400}
.ft .key{white-space:nowrap}
.hl{white-space:nowrap}
.hl .k{display:inline-block;width:7mm;font-size:6.4pt;color:${SOFT}}
.hl .hashc{font-size:6.2pt;word-break:normal}
.record{margin:3mm 0;padding:3mm 4mm;border-radius:2mm;background:#f6f5f3;break-inside:avoid}
.record .h{font-weight:700;margin-bottom:1.5mm}
.record dl{display:grid;grid-template-columns:28mm 1fr;gap:1mm 3mm;margin:0;font-size:8.2pt}
.record dt{color:${SOFT}}
.record dd{margin:0}
.signed{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;margin-top:3mm;break-inside:avoid}
.signed .fine{flex:1}`;

function published(payload: OpenDataManifestPayload): string {
  return payload.publishedBy === null
    ? `Published automatically when the national consolidated report ${payload.ncrReference ?? ''} was approved.`
    : `Published by ${payload.publishedBy}, EACC supervisor.`;
}

function hashLine(label: string, sha256: string): string {
  return `<div class="hl"><span class="k">${esc(label)}</span><span class="hashc">${esc(sha256)}</span></div>`;
}

/**
 * The manifest of a published open-data release (spec 09b): the release's year, kind and version,
 * when its figures were built and how it was published, each table's rows, hidden cells and the
 * SHA-256 of its JSON and CSV files, and how to check a downloaded file against it. Issued by
 * EACC when the release is published. Public: no protective marking, and the verify page may show
 * the whole manifest; it holds no figure and no personal data.
 */
export const openDataManifestV1: DocumentTemplate<OpenDataManifestPayload> = {
  type: OPEN_DATA_MANIFEST,
  version: 1,
  disclosureLevel: 'public',
  requires: { subjectPerson: 'refused' },
  title: 'Open-data release manifest',
  payload: openDataManifestPayload,

  reference() {
    return null;
  },

  subjectVersion(payload) {
    return payload.version;
  },

  publicPayload(payload, { issuedAt }) {
    return {
      type: OPEN_DATA_MANIFEST,
      issuerName: EACC_ISSUER.name,
      issuerCode: EACC_ISSUER.code,
      issuedAt: issuedAt.toISOString(),
      reference: null,
      version: payload.version,
      releaseId: payload.releaseId,
      financialYear: payload.financialYear,
      kind: payload.kind,
      builtAt: payload.builtAt,
      ncrReference: payload.ncrReference,
      suppressionThreshold: payload.suppressionThreshold,
      tables: payload.tables,
      releaseSha256: payload.releaseSha256,
    };
  },

  footer(payload) {
    return { issuerName: EACC_ISSUER.name, reference: null, version: payload.version };
  },

  render(payload, { issuedAt, signerName }) {
    const fy = esc(payload.financialYear);
    const kind = KIND_NAMES[payload.kind];
    const rows = payload.tables
      .map(
        (entry, index) =>
          `<tr><td class="n">${index + 1}</td><td>${esc(TABLE_LABELS[entry.table] ?? entry.table)}<span class="sub mono key">${esc(entry.table)}</span></td><td class="num">${formatCount(entry.rows)}</td><td class="num">${formatCount(entry.cellsSuppressed)}</td><td>${hashLine('JSON', entry.sha256Json)}${hashLine('CSV', entry.sha256Csv)}</td></tr>`,
      )
      .join('');
    const body = `${letterhead(EACC_ISSUER)}
<div class="doc-h"><div class="t1" role="heading" aria-level="1">Open-data release manifest</div><div class="doc-sub">FY ${fy} · ${esc(kind.toLowerCase())} · version ${String(payload.version)}</div></div>
<dl class="skv">
<dt>Release</dt><dd class="mono">${esc(payload.releaseId)}</dd>
<dt>Financial year</dt><dd>FY ${fy} (${esc(financialYearPeriod(payload.financialYear))})</dd>
<dt>Kind</dt><dd>${esc(kind)}, version ${String(payload.version)}</dd>
<dt>Figures as at</dt><dd>${esc(formatDateTime(payload.builtAt))}</dd>
<dt>Published</dt><dd>${esc(formatDateTime(issuedAt))}<span class="fine">${esc(published(payload))}</span></dd>
<dt>Release file</dt><dd>${hashLine('JSON', payload.releaseSha256)}</dd>
</dl>
<table class="ft"><caption>Files</caption><thead><tr><th class="n">No</th><th>Table</th><th class="num">Rows</th><th class="num">Hidden</th><th>SHA-256</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="record"><div class="h">How to use this manifest</div><dl>
<dt>Check a file</dt><dd>Compute the SHA-256 of the file you downloaded and compare it with the value above.</dd>
<dt>Suppression</dt><dd>Cells based on fewer than ${formatCount(payload.suppressionThreshold)} officers are hidden, and further cells are hidden where a total would reveal them. Hidden counts those cells per table.</dd>
<dt>Personal data</dt><dd>None. Counts and rates by Commission, reporting entity type and cycle only.</dd>
<dt>Get the files</dt><dd>The Adili Online open-data page (CSV and JSON per table, and release.json)</dd>
</dl></div>
<div class="signed"><div class="fine">Issued by the Ethics and Anti-Corruption Commission through Adili Online when the release was published, ${esc(formatDate(issuedAt))}.</div>${signatureNote(signerName, issuedAt)}</div>`;
    return htmlDocument(
      `Open-data release manifest FY ${payload.financialYear} ${kind} v${String(payload.version)}`,
      STYLES,
      body,
    );
  },
};
