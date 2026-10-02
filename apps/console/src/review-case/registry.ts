import type { DeclarationV1 } from '@adili/forms';
import {
  findItem,
  formatDate,
  type MatchRelation,
  personFullName,
  personKind,
  type PersonKind,
  plural,
  type SystemCheckStatus,
  typeLabel,
} from '@adili/ui';

import type {
  CaseData,
  CaseFlag,
  CaseRegistryRow,
  CaseRegistryView as RegistryView,
} from '../server/review-case.server';
import type { CaseListItem, RegistrySummary, RegistrySystem } from '../server/review/types';
import { REGISTRY_COPY } from './messages';
import type { CaseViewer } from './view';

/**
 * The Registry tab's arithmetic (spec 07b FE-2): the people checked and a status row per
 * registry for each, the registry records beside the declared items for the match tables, and
 * who may re-check. Pure, so the tab only lays out what these return.
 */

/** In the order review lists them (review.yaml `RegistrySystem`). */
export const REGISTRY_SYSTEMS: readonly RegistrySystem[] = ['kra', 'ntsa', 'brs', 'ardhisasa'];

/** Registries' own names, never translated. */
export const SYSTEM_NAMES: Record<RegistrySystem, string> = {
  kra: 'KRA',
  ntsa: 'NTSA',
  brs: 'BRS',
  ardhisasa: 'ArdhiSasa',
};

/** The registry each registry rule compares the declaration with. */
export const RULE_SYSTEMS: Partial<Record<CaseFlag['ruleId'], RegistrySystem>> = {
  'registry-parcel-undeclared': 'ardhisasa',
  'declared-parcel-not-found': 'ardhisasa',
  'registry-vehicle-undeclared': 'ntsa',
  'declared-vehicle-not-found': 'ntsa',
  'registry-directorship-undeclared': 'brs',
  'declared-company-not-found': 'brs',
  'directorship-employer-supplier': 'brs',
  'kra-pin-missing': 'kra',
  'kra-non-compliant': 'kra',
  'kra-income-mismatch': 'kra',
  'registry-parcel-number-missing': 'ardhisasa',
  'registry-vehicle-registration-missing': 'ntsa',
  'registry-company-registration-missing': 'brs',
  'registry-company-dissolved': 'brs',
  'registry-supplier-check-not-run': 'brs',
};

type ViewSystem = RegistryView['persons'][number]['systems'][number];
export type RegistryRow = CaseRegistryRow;

/** One registry for one person, as its status row shows it. */
export interface SystemRow {
  /** `{personKey}:{system}`, unique in the tab. */
  key: string;
  system: RegistrySystem;
  name: string;
  status: SystemCheckStatus;
  description: string;
  /** When this registry was checked, if not at the same time as the rest of the case. */
  checkedAt: string | null;
  /** Opens to its match table and flags: it answered, and its records were read. */
  expandable: boolean;
  rows: RegistryRow[];
  /** Its flags, open ones first, then reviewed, then closed by a re-check; highest severity first. */
  flags: CaseFlag[];
}

export interface RegistryPerson {
  personKey: string;
  name: string;
  kind: PersonKind;
  hasNationalId: boolean;
  /** Empty for someone without a national ID: no registry can be asked. */
  systems: SystemRow[];
}

/** The Registry tab's content, from the registry view or, failing that, the case's last check. */
export interface RegistryLayout {
  checkedAt: string | null;
  persons: RegistryPerson[];
  /** The registry records were read; false when only the statuses are known. */
  recordsLoaded: boolean;
  /** Nobody on the declaration has a national ID, so nothing can be checked. */
  noIds: boolean;
}

/** The review service's reason for BRS when only the employer-supplier check went unanswered. */
const SUPPLIER_CHECK_UNAVAILABLE = 'supplier-check-unavailable';

/** Highest first, as the flags tab orders them (`SEVERITY_ORDER`, which imports this module). */
const SEVERITIES: readonly CaseFlag['severity'][] = ['high', 'medium', 'low', 'info'];

/** Open flags first, then reviewed, then closed by a re-check; by severity within each. */
function flagOrder(flag: CaseFlag): number {
  return flagState(flag) * SEVERITIES.length + SEVERITIES.indexOf(flag.severity);
}

function flagState(flag: CaseFlag): number {
  if (flag.reviewed === null && !flag.closedReason) return 0;
  return flag.reviewed !== null ? 1 : 2;
}

/** A flag as the case now has it: after a review, the case's copy is the newer one. */
function current(flag: CaseFlag, latest: ReadonlyMap<string, CaseFlag>): CaseFlag {
  return latest.get(flag.id) ?? flag;
}

/** A registry's open notes (info flags), as its collapsed row names them. */
export interface RegistryNotes {
  /** `registry-supplier-check-not-run`: the employer-supplier check could not run. */
  supplierCheckNotRun: boolean;
  /** Other notes, e.g. land declared without its parcel number, a dissolved company. */
  others: number;
}

const NO_NOTES: RegistryNotes = { supplierCheckNotRun: false, others: 0 };

/** The notes among a registry's flags: info flags a re-check has not closed. */
export function registryNotes(flags: readonly CaseFlag[]): RegistryNotes {
  const open = flags.filter((flag) => flag.severity === 'info' && !flag.closedReason);
  const notRun = open.filter((flag) => flag.ruleId === 'registry-supplier-check-not-run');
  return { supplierCheckNotRun: notRun.length > 0, others: open.length - notRun.length };
}

/**
 * The words under a registry's name: how many records, all declared, or how many indicators;
 * that it could not be reached; or that checks have not run yet. Notes (info flags) follow, so
 * they show without opening the row, and a registry with notes never reads "all declared".
 */
export function statusDescription(
  system: RegistrySystem,
  status: SystemCheckStatus,
  counts: {
    records: number | null;
    /** Open indicators, info flags (notes) aside. */
    indicators: number;
    notes?: RegistryNotes;
    /** KRA: the income declared to KRA was compared (false when it could not be). */
    incomeCompared?: boolean;
    /** The person checked, by first name, for the no-ID copy. */
    personName?: string;
    /** Why the system is unavailable, as the check gives it. */
    reason?: string | null;
  },
): string {
  const copy = REGISTRY_COPY.rows;
  const notes = counts.notes ?? NO_NOTES;
  const noted = [
    ...(notes.supplierCheckNotRun ? [copy.supplierCheckNotRun] : []),
    ...(notes.others > 0 ? [copy.notes(notes.others)] : []),
  ];
  const withNotes = (text: string) => [text, ...noted].join(', ');
  switch (status) {
    case 'matched':
      if (system === 'kra') {
        return withNotes(
          counts.incomeCompared === false ? copy.kraMatchedNoIncome : copy.kraMatched,
        );
      }
      if (noted.length > 0) {
        if (counts.records === null) return withNotes(copy.noIndicators);
        return withNotes(counts.records === 0 ? copy.noRecords : copy.records(counts.records));
      }
      if (counts.records === null) return copy.allDeclared;
      return counts.records === 0 ? copy.noRecords : copy.matched(counts.records);
    case 'mismatched':
      return withNotes(
        counts.indicators === 0 ? copy.mismatchedNoCount : copy.mismatched(counts.indicators),
      );
    case 'unavailable':
      // BRS itself answered: only the employer's supplier list (HR) did not.
      return counts.reason === SUPPLIER_CHECK_UNAVAILABLE
        ? copy.supplierListUnavailable
        : copy.unavailable(SYSTEM_NAMES[system]);
    case 'not-checked':
      return copy.notChecked;
    case 'no-id':
      return REGISTRY_COPY.noIdBody(counts.personName ?? '');
  }
}

function systemRow(
  personKey: string,
  entry: ViewSystem,
  context: {
    personName: string;
    checkedAt: string | null;
    recordsLoaded: boolean;
    latest: ReadonlyMap<string, CaseFlag>;
  },
): SystemRow {
  const flags = entry.flags
    .map((flag) => current(flag, context.latest))
    .sort((a, b) => flagOrder(a) - flagOrder(b));
  const answered = entry.status === 'matched' || entry.status === 'mismatched';
  return {
    key: `${personKey}:${entry.system}`,
    system: entry.system,
    name: SYSTEM_NAMES[entry.system],
    status: entry.status,
    description: statusDescription(entry.system, entry.status, {
      records: context.recordsLoaded ? entry.rows.length : null,
      indicators: flags.filter((flag) => flag.severity !== 'info' && !flag.closedReason).length,
      notes: registryNotes(flags),
      incomeCompared:
        context.recordsLoaded && entry.system === 'kra'
          ? entry.rows.some((row) => typeof row.registryRecord.incomeDifferencePercent === 'number')
          : undefined,
      personName: context.personName,
      reason: entry.reason,
    }),
    checkedAt: entry.checkedAt && entry.checkedAt !== context.checkedAt ? entry.checkedAt : null,
    expandable: answered && context.recordsLoaded,
    rows: entry.rows,
    flags,
  };
}

/** "Imani" of "Imani Wairimu Kamau", as the no-ID copy names a person. */
export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

/**
 * The Registry tab from `GET .../registry` (records loaded) or from the case's registry summary
 * when that failed (statuses of the last check only). `flags` are the case's own: a flag marked
 * reviewed since the registry view was read shows its review.
 */
export function registryLayout(
  view: RegistryView,
  flags: readonly CaseFlag[],
  recordsLoaded: boolean,
): RegistryLayout {
  const latest = new Map(flags.map((flag) => [flag.id, flag]));
  const persons = view.persons.map((person): RegistryPerson => ({
    personKey: person.personKey,
    name: person.personName,
    kind: personKind(person.personKey),
    hasNationalId: person.hasNationalId,
    systems: person.hasNationalId
      ? person.systems.map((entry) =>
          systemRow(person.personKey, entry, {
            personName: firstName(person.personName),
            checkedAt: view.checkedAt,
            recordsLoaded,
            latest,
          }),
        )
      : [],
  }));
  return {
    checkedAt: view.checkedAt,
    persons,
    recordsLoaded,
    noIds: persons.length > 0 && persons.every((person) => !person.hasNationalId),
  };
}

/**
 * A registry view built from what the case already holds (its registry summary, the declaration
 * and the flags), for when the records cannot be read: the statuses of the last check, people in
 * the declaration's order, no records.
 */
export function summaryView(
  summary: RegistrySummary,
  document: DeclarationV1 | null,
  flags: readonly CaseFlag[],
  declarantName: string,
): RegistryView {
  const people: { personKey: string; personName: string }[] = document
    ? document.statements.map((statement) => ({
        personKey: statement.personKey,
        personName: personFullName(statement.personName),
      }))
    : [
        { personKey: 'officer', personName: declarantName },
        ...[...new Set(summary.checks.map((check) => check.personKey))]
          .filter((key) => key !== 'officer')
          .map((personKey) => ({ personKey, personName: '' })),
      ];
  return {
    checkedAt: summary.checkedAt,
    persons: people.map(({ personKey, personName }) => {
      const own = summary.checks.filter((check) => check.personKey === personKey);
      return {
        personKey,
        personName,
        hasNationalId:
          own.length > 0 ? own.some((check) => check.status !== 'no-id') : personKey === 'officer',
        systems: REGISTRY_SYSTEMS.map((system) => {
          const check = own.find((entry) => entry.system === system);
          return {
            system,
            status: check?.status ?? 'not-checked',
            reason: check?.reason ?? null,
            checkedAt: check?.checkedAt ?? null,
            resultId: check?.resultId ?? null,
            rows: [],
            flags: flags.filter(
              (flag) =>
                RULE_SYSTEMS[flag.ruleId] === system &&
                flag.itemRefs.some((ref) => ref.personKey === personKey),
            ),
          };
        }),
      };
    }),
  };
}

/** A registry could not be checked for someone on the case: the tab shows a mark. */
export function registryNeedsAttention(detail: Pick<CaseData, 'registry'>): boolean {
  return detail.registry.checks.some((check) => check.status === 'unavailable');
}

// ---------------------------------------------------------------- match tables

/** A row of a registry's match table, as plain text the table lays out. */
export interface MatchRow {
  id: string;
  /** The row header: parcel number, vehicle registration, company name, or the identifier declared. */
  record: string;
  recordDetail: string | null;
  relation: MatchRelation;
  /** The declared item's type, e.g. "Land". */
  declared: string | null;
  declaredDetail: string | null;
  /** For "Go to item". */
  itemId: string | null;
  /** A company on the declarant's employer's supplier list (`directorship-employer-supplier`). */
  supplier: boolean;
}

function str(record: RegistryRow['registryRecord'], key: string): string | null {
  const value = record[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function num(record: RegistryRow['registryRecord'], key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function date(record: RegistryRow['registryRecord'], key: string): string | null {
  const value = str(record, key);
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? formatDate(value) : null;
}

function details(parts: (string | null)[]): string | null {
  const present = parts.filter((part): part is string => part !== null);
  return present.length > 0 ? present.join(' · ') : null;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A BRS role as words: `director_shareholder` → "Director and shareholder". */
export function roleWords(role: string): string {
  return capitalise(
    role
      .toLowerCase()
      .split(/[_\s-]+/)
      .filter(Boolean)
      .join(' and '),
  );
}

/** Identifiers compare without case or spacing, as review matches them. */
function sameIdentifier(a: string, b: string): boolean {
  const key = (value: string) => value.replace(/[\s/-]+/g, '').toUpperCase();
  return key(a) === key(b);
}

const IDENTIFIER: Record<Exclude<RegistrySystem, 'kra'>, string> = {
  ardhisasa: 'parcelNumber',
  ntsa: 'registrationNumber',
  brs: 'companyRegistrationNumber',
};

function recordDetail(
  system: Exclude<RegistrySystem, 'kra'>,
  record: RegistryRow['registryRecord'],
) {
  switch (system) {
    case 'ardhisasa': {
      const area = num(record, 'areaHectares');
      return details([
        str(record, 'county'),
        area === null ? null : `${String(area)} ha`,
        str(record, 'tenure'),
        around(date(record, 'registeredOn'), REGISTRY_COPY.table.registered),
      ]);
    }
    case 'ntsa':
      return details([
        [str(record, 'make'), str(record, 'model')].filter(Boolean).join(' ') || null,
        str(record, 'yearOfManufacture'),
        around(date(record, 'registeredOn'), REGISTRY_COPY.table.registered),
      ]);
    case 'brs': {
      const role = str(record, 'role');
      const shares = num(record, 'shares');
      const status = str(record, 'companyStatus');
      return details([
        str(record, 'companyRegistrationNumber'),
        role === null
          ? null
          : roleWords(role) + (shares === null ? '' : `, ${REGISTRY_COPY.table.shares(shares)}`),
        // Only a company that is not trading is worth a word.
        status && !['active', 'registered'].includes(status.toLowerCase())
          ? capitalise(status.toLowerCase())
          : null,
        around(date(record, 'appointedOn'), REGISTRY_COPY.table.appointed),
      ]);
    }
  }
}

function around(value: string | null, template: (value: string) => string): string | null {
  return value === null ? null : template(value);
}

/**
 * A registry's rows for its match table: each registry record (its identifier, then its details)
 * beside the declared item it matched, or marked not declared; then each declared identifier the
 * registry does not know. A BRS company on the employer's supplier list is marked.
 */
export function matchRows(
  system: Exclude<RegistrySystem, 'kra'>,
  rows: readonly RegistryRow[],
  document: DeclarationV1 | null,
  flags: readonly CaseFlag[],
): MatchRow[] {
  const suppliers = flags
    .filter((flag) => flag.ruleId === 'directorship-employer-supplier')
    .flatMap((flag) => {
      const number = flag.evidence.companyRegistrationNumber;
      return typeof number === 'string' ? [number] : [];
    });
  const key = IDENTIFIER[system];
  return rows.map((row, index): MatchRow => {
    const record = row.registryRecord;
    const identifier = str(record, key) ?? '';
    const found = row.declaredItemId && document ? findItem(document, row.declaredItemId) : null;
    const missing = row.relation === 'not-in-registry';
    return {
      id: `${row.relation}:${identifier}:${String(index)}`,
      record:
        system === 'brs' && !missing ? (str(record, 'companyName') ?? identifier) : identifier,
      recordDetail: missing
        ? REGISTRY_COPY.table.notInRegistry[system]
        : recordDetail(system, record),
      relation: row.relation,
      declared: found ? typeLabel(found.category, found.item) : null,
      declaredDetail: (found?.item.description.trim() ?? '') || null,
      itemId: found ? row.declaredItemId : null,
      supplier:
        system === 'brs' && !missing && suppliers.some((each) => sameIdentifier(each, identifier)),
    };
  });
}

/** A line of the KRA comparison: what KRA holds, against the declaration. */
export interface KraLine {
  id: 'pin' | 'compliance' | 'income';
  label: string;
  /** A badge with its word and tone, e.g. "On record" (success). */
  badge: { text: string; tone: 'success' | 'warning' | 'default' } | null;
  text: string | null;
  /** The line is an indicator (non-compliant, income 25% or more apart). */
  warning: boolean;
}

const INCOME_THRESHOLD = 25;

/**
 * The KRA comparison: whether a PIN is on record for the ID, the compliance status and its
 * certificate's validity, and how far the income declared to KRA is from the income declared
 * here, as a percentage only (never an amount).
 */
export function kraLines(rows: readonly RegistryRow[]): KraLine[] {
  const copy = REGISTRY_COPY.kra;
  const records = rows.map((row) => row.registryRecord);
  if (records.length === 0) {
    return [
      {
        id: 'pin',
        label: copy.pin,
        badge: { text: copy.noPin, tone: 'warning' },
        text: null,
        warning: true,
      },
    ];
  }
  const statuses = records.map((record) => str(record, 'complianceStatus') ?? 'unknown');
  const status = statuses.includes('non-compliant')
    ? 'non-compliant'
    : statuses.every((each) => each === 'compliant')
      ? 'compliant'
      : 'unknown';
  const validUntil = records.map((record) => str(record, 'validUntil')).find(Boolean) ?? null;
  const difference = records
    .map((record) => num(record, 'incomeDifferencePercent'))
    .find((value) => value !== null);
  return [
    {
      id: 'pin',
      label: copy.pin,
      badge: {
        text: records.length === 1 ? copy.onRecord : copy.pins(records.length),
        tone: 'success',
      },
      text: null,
      warning: false,
    },
    {
      id: 'compliance',
      label: copy.compliance,
      badge: {
        text: copy.statuses[status],
        tone:
          status === 'compliant' ? 'success' : status === 'non-compliant' ? 'warning' : 'default',
      },
      text:
        status === 'compliant' && validUntil
          ? copy.validUntil(formatDate(validUntil))
          : copy.noCertificate,
      warning: status === 'non-compliant',
    },
    {
      id: 'income',
      label: copy.income,
      badge: null,
      text: difference === undefined ? copy.incomeNotCompared : copy.incomeDifference(difference),
      warning: difference !== undefined && difference >= INCOME_THRESHOLD,
    },
  ];
}

// ---------------------------------------------------------------- re-check

/**
 * Who may re-check a case's registries: its assignee or a supervisor (`allowed`); another
 * reviewer sees the action disabled (`forbidden`); a determined case is no longer checked.
 */
export function recheckAccess(
  item: Pick<CaseListItem, 'assignee' | 'status'>,
  viewer: CaseViewer,
): 'allowed' | 'forbidden' | 'hidden' {
  if (item.status === 'determined') return 'hidden';
  if (viewer.supervisor || item.assignee?.subject === viewer.subject) return 'allowed';
  return 'forbidden';
}

/** Whole minutes until the next re-check is accepted, from review's `retryAfterSeconds`. */
export function cooldownMinutes(retryAfterSeconds: number): number {
  return Math.max(1, Math.ceil(retryAfterSeconds / 60));
}

/** The re-check has stored its results: the latest check is not the one seen before it. */
export function recheckLanded(before: string | null, after: string | null): boolean {
  return after !== null && after !== before;
}

/** The words for "{n} minutes", for the cooldown; kept on one line (a no-break space). */
export function minutesWords(minutes: number): string {
  return plural(minutes, 'minute').replace(' ', '\u00a0');
}

/**
 * When the next re-check is accepted (epoch ms): the later of what the case says (review's
 * `recheckAvailableAt`, ten minutes after the last re-check) and the end of a refusal's wait seen
 * on this page (a 429: someone re-checked after the page loaded). Null when neither is known.
 */
export function recheckAvailableAt(
  summary: Pick<RegistrySummary, 'recheckAvailableAt'>,
  refusedUntil: number | null,
): number | null {
  const fromCase = summary.recheckAvailableAt ? Date.parse(summary.recheckAvailableAt) : null;
  if (fromCase === null) return refusedUntil;
  return refusedUntil === null ? fromCase : Math.max(fromCase, refusedUntil);
}

/**
 * "Re-checked recently. Try again in {m} minutes." while `availableAt` is ahead of `now`; null
 * once a re-check is accepted.
 */
export function cooldownText(availableAt: number | null, now: number): string | null {
  if (availableAt === null || availableAt <= now) return null;
  return REGISTRY_COPY.recheck.cooldown(minutesWords(cooldownMinutes((availableAt - now) / 1000)));
}
