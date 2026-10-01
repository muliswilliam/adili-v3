import type { AssetItem, DeclarationV1, Statement } from '@adili/forms';

import type { components } from '../integration-gateway/integration-gateway-api.gen.js';
import { normalise, statementSectionKey } from './match.js';
import type { RuleId, Severity } from './registry.js';
import { type Evidence, flag, type Flag, type ItemRef, ref } from './rules.js';

type Schemas = components['schemas'];
/** integration-gateway.yaml lookup results, as the gateway answers them. */
export type KraResult = Schemas['KraResult'];
export type NtsaResult = Schemas['NtsaResult'];
export type BrsResult = Schemas['BrsResult'];
export type ArdhisasaResult = Schemas['ArdhisasaResult'];
export type SupplierCheckResult = Schemas['SupplierCheckResult'];

/** review.yaml `RegistrySystem`, in the order the Registry tab lists them. */
export const REGISTRY_SYSTEMS = ['kra', 'ntsa', 'brs', 'ardhisasa'] as const;
export type RegistrySystem = (typeof REGISTRY_SYSTEMS)[number];

/** review.yaml `RegistryCheckStatus`. */
export const REGISTRY_CHECK_STATUSES = [
  'matched',
  'mismatched',
  'unavailable',
  'not-checked',
  'no-id',
] as const;
export type RegistryCheckStatus = (typeof REGISTRY_CHECK_STATUSES)[number];

/**
 * A lookup that gave no answer: the gateway's own `unavailable` result, or one the caller writes
 * when the gateway itself could not be reached after its retries (no result id then).
 */
export interface Unavailable {
  outcome: 'unavailable';
  reason: string | null;
  resultId?: string | null;
}

/** One person's lookups; a system left out was not looked up and is `not-checked`. */
export interface PersonRegistryResults {
  kra?: KraResult | Unavailable;
  ntsa?: NtsaResult | Unavailable;
  brs?: BrsResult | Unavailable;
  ardhisasa?: ArdhisasaResult | Unavailable;
}

export interface RegistryMatchInput {
  /** The submitted version: its statements are the people checked, its items what is declared. */
  document: DeclarationV1;
  /**
   * National ID per statement's person key (see `householdIds`). A person without one has no
   * lookups and every system `no-id`.
   */
  householdIds: Readonly<Record<string, string | null | undefined>>;
  /** Lookups per person key. */
  results: Readonly<Record<string, PersonRegistryResults | undefined>>;
  /**
   * Whether each of the officer's BRS companies supplies the officer's employer, by company
   * registration number. A company left out was not checked (no employer code, say).
   */
  suppliers?: Readonly<Record<string, SupplierCheckResult | Unavailable>>;
}

/** One person's status in one registry, as stored on the case (`registry_checks`). */
export interface RegistryCheck {
  personKey: string;
  system: RegistrySystem;
  status: RegistryCheckStatus;
  /** Why a system is unavailable: the gateway's reason, or `supplier-check-unavailable`. */
  reason: string | null;
  /** The gateway's result id, to pull the records from when the Registry tab opens. */
  resultId: string | null;
}

/** Why a declared item could not be compared: the spec's `info` notes, which carry no rule. */
export type RegistryNoteKind =
  | 'parcel-number-missing'
  | 'vehicle-registration-missing'
  | 'company-registration-missing'
  | 'company-dissolved';

export interface RegistryNote {
  kind: RegistryNoteKind;
  system: RegistrySystem;
  evidence: Evidence;
  itemRefs: ItemRef[];
}

export interface RegistryMatch {
  /** Registry flags, in the same shape and score as the deterministic rules' flags. */
  flags: Flag[];
  /** A status per person (statement order) and system (`REGISTRY_SYSTEMS` order). */
  checks: RegistryCheck[];
  notes: RegistryNote[];
}

/** The national ID of each statement's person: the officer's from the directory, others' as declared. */
export function householdIds(
  document: DeclarationV1,
  officerNationalId: string | null,
): Record<string, string | null> {
  const declared = new Map<string, string | undefined>([
    ...document.spouses.items.map((s) => [`spouse:${s.id}`, s.nationalId] as const),
    ...document.children.items.map((c) => [`child:${c.id}`, c.nationalId] as const),
  ]);
  return Object.fromEntries(
    document.statements.map(({ personKey }): [string, string | null] => {
      const id = (personKey === 'officer' ? officerNationalId : declared.get(personKey))?.trim();
      // A blank ID is no ID.
      return [personKey, id === undefined || id === '' ? null : id];
    }),
  );
}

/**
 * Matches registry records against the declared items (spec 07b, BE-5): parcels by parcel
 * number, vehicles by registration, companies by registration number (or exact name, which is
 * what a BRS pre-fill writes), KRA by PIN presence, compliance and income. Pure: the lookups are
 * made before and passed in. Evidence holds identifiers, counts, percentages and statuses only.
 */
export function matchRegistries(input: RegistryMatchInput): RegistryMatch {
  const match: RegistryMatch = { flags: [], checks: [], notes: [] };
  for (const statement of input.document.statements) {
    const { personKey } = statement;
    const results = input.householdIds[personKey] ? (input.results[personKey] ?? {}) : null;
    for (const system of REGISTRY_SYSTEMS) {
      const result = results?.[system];
      if (!results || !result) {
        match.checks.push(check(personKey, system, results ? 'not-checked' : 'no-id'));
        continue;
      }
      if (result.outcome === 'unavailable') {
        match.checks.push(check(personKey, system, 'unavailable', result));
        continue;
      }
      const person = { statement, document: input.document };
      const found =
        system === 'kra'
          ? kra(person, result as KraResult)
          : system === 'ntsa'
            ? vehicles(person, result as NtsaResult)
            : system === 'brs'
              ? companies(person, result as BrsResult, input.suppliers ?? {})
              : parcels(person, result as ArdhisasaResult);
      match.flags.push(...found.flags);
      match.notes.push(...found.notes);
      match.checks.push(
        found.unavailable
          ? check(personKey, system, 'unavailable', { ...result, reason: found.unavailable })
          : check(personKey, system, found.flags.length > 0 ? 'mismatched' : 'matched', result),
      );
    }
  }
  return match;
}

interface Person {
  statement: Statement;
  document: DeclarationV1;
}

interface SystemMatch {
  flags: Flag[];
  notes: RegistryNote[];
  /** Set when part of the check had no answer, though the main lookup did. */
  unavailable?: string;
}

function check(
  personKey: string,
  system: RegistrySystem,
  status: RegistryCheckStatus,
  result?: { reason?: string | null; resultId?: string | null },
): RegistryCheck {
  return {
    personKey,
    system,
    status,
    reason: status === 'unavailable' ? (result?.reason ?? null) : null,
    resultId: result?.resultId ?? null,
  };
}

/** Identifiers compare without case, spaces or separators, as spec 05b's pre-fill does. */
export function sameIdentifier(a: string, b: string): boolean {
  return identifierKey(a) !== '' && identifierKey(a) === identifierKey(b);
}

const identifierKey = (value: string) => value.toUpperCase().replace(/[\s/.,-]+/gu, '');

/** Land and buildings by parcel number; land declared without one cannot be compared. */
function parcels({ statement }: Person, result: ArdhisasaResult): SystemMatch {
  return byIdentifier(statement, {
    system: 'ardhisasa',
    types: ['land', 'building'],
    identifier: (item) => item.details?.parcelNumber,
    registry: result.parcels.map((parcel) => parcel.parcelNumber),
    evidenceKey: 'parcelNumber',
    undeclared: ['registry-parcel-undeclared', 'high'],
    notFound: ['declared-parcel-not-found', 'medium'],
    missing: { kind: 'parcel-number-missing', types: ['land'] },
  });
}

/** Vehicles by registration; a vehicle declared without one cannot be compared. */
function vehicles({ statement }: Person, result: NtsaResult): SystemMatch {
  return byIdentifier(statement, {
    system: 'ntsa',
    types: ['vehicle'],
    identifier: (item) => item.details?.registration,
    registry: result.vehicles.map((vehicle) => vehicle.registrationNumber),
    evidenceKey: 'registrationNumber',
    undeclared: ['registry-vehicle-undeclared', 'medium'],
    notFound: ['declared-vehicle-not-found', 'low'],
    missing: { kind: 'vehicle-registration-missing', types: ['vehicle'] },
  });
}

interface IdentifierRule {
  system: RegistrySystem;
  types: AssetItem['type'][];
  identifier: (item: AssetItem) => string | undefined;
  registry: string[];
  evidenceKey: string;
  undeclared: [RuleId, Severity];
  notFound: [RuleId, Severity];
  missing: { kind: RegistryNoteKind; types: AssetItem['type'][] };
}

function byIdentifier(statement: Statement, rule: IdentifierRule): SystemMatch {
  const { personKey } = statement;
  const declared = statement.assets.filter((item) => rule.types.includes(item.type));
  const identified = declared.flatMap((item) => {
    const identifier = rule.identifier(item)?.trim();
    return identifier ? [{ item, identifier }] : [];
  });
  const registry = uniqueBy(rule.registry, identifierKey);
  const isDeclared = (id: string) => identified.some((d) => sameIdentifier(d.identifier, id));
  const inRegistry = (id: string) => registry.some((r) => sameIdentifier(r, id));
  return {
    flags: [
      ...registry
        .filter((id) => !isDeclared(id))
        .map((id) =>
          flag(...rule.undeclared, { [rule.evidenceKey]: id }, [statementRef(personKey)]),
        ),
      ...identified
        .filter(({ identifier }) => !inRegistry(identifier))
        .map(({ item, identifier }) =>
          flag(...rule.notFound, { [rule.evidenceKey]: identifier }, [ref({ personKey, item })]),
        ),
    ],
    notes: declared
      .filter((item) => rule.missing.types.includes(item.type) && !rule.identifier(item)?.trim())
      .map((item) => ({
        kind: rule.missing.kind,
        system: rule.system,
        evidence: {},
        itemRefs: [ref({ personKey, item })],
      })),
  };
}

/** A company the declaration mentions: what it says about it and where. */
interface DeclaredCompany {
  texts: string[];
  itemRef: ItemRef;
  /** Listed securities are held through the CDS, not on BRS, so they are never "not found". */
  checkable: boolean;
}

/** The person's shareholdings and securities, and for the officer the paragraph 9 interests. */
function declaredCompanies({ statement, document }: Person): DeclaredCompany[] {
  const { personKey } = statement;
  const other: ItemRef = { personKey, itemId: null, sectionKey: 'other' };
  const { directorships, memberships } = document.otherInformation.registrableInterests;
  return [
    ...statement.assets
      .filter((item) => item.type === 'shareholding' || item.type === 'securities')
      .map((item) => ({
        texts: [item.details?.issuer ?? '', item.description],
        itemRef: ref({ personKey, item }),
        checkable: item.type === 'shareholding',
      })),
    ...(personKey === 'officer'
      ? [
          ...directorships.map((d) => ({ texts: [d.company], itemRef: other, checkable: true })),
          ...memberships
            .filter((m) => m.kind === 'company')
            .map((m) => ({ texts: [m.entity], itemRef: other, checkable: true })),
        ]
      : []),
  ];
}

/**
 * BRS directorships and shareholdings against the declared companies, and for the officer
 * whether a company supplies their employer. A declared company is the registry's when its text
 * carries the registration number or its name is the registry's name exactly.
 */
function companies(
  person: Person,
  result: BrsResult,
  suppliers: NonNullable<RegistryMatchInput['suppliers']>,
): SystemMatch {
  const { personKey } = person.statement;
  const declared = declaredCompanies(person);
  const registry = uniqueBy(result.directorships, (d) =>
    identifierKey(d.companyRegistrationNumber),
  );
  const refersTo = (company: DeclaredCompany, record: (typeof registry)[number]) =>
    company.texts.some(
      (text) =>
        mentionsIdentifier(text, record.companyRegistrationNumber) ||
        sameCompanyName(text, record.companyName),
    );
  const declaring = (record: (typeof registry)[number]) =>
    declared.filter((company) => refersTo(company, record));

  const flags: Flag[] = [];
  const notes: RegistryNote[] = [];
  for (const record of registry) {
    const evidence = {
      companyRegistrationNumber: record.companyRegistrationNumber,
      role: record.role,
    };
    if (declaring(record).length === 0) {
      flags.push(
        flag('registry-directorship-undeclared', 'medium', evidence, [statementRef(personKey)]),
      );
    } else if (record.companyStatus === 'dissolved') {
      notes.push({
        kind: 'company-dissolved',
        system: 'brs',
        evidence: { companyRegistrationNumber: record.companyRegistrationNumber },
        itemRefs: unique(declaring(record).map((c) => c.itemRef)),
      });
    }
  }
  for (const company of declared) {
    const numbers = unique(company.texts.flatMap(registrationNumbers));
    const known = registry.filter((record) => refersTo(company, record));
    for (const number of numbers) {
      if (
        !company.checkable ||
        registry.some((r) => sameIdentifier(r.companyRegistrationNumber, number))
      )
        continue;
      flags.push(
        flag('declared-company-not-found', 'low', { companyRegistrationNumber: number }, [
          company.itemRef,
        ]),
      );
    }
    if (numbers.length === 0 && known.length === 0) {
      notes.push({
        kind: 'company-registration-missing',
        system: 'brs',
        evidence: {},
        itemRefs: [company.itemRef],
      });
    }
  }

  let unavailable: string | undefined;
  if (personKey === 'officer') {
    for (const record of registry) {
      const supplier = Object.entries(suppliers).find(([number]) =>
        sameIdentifier(number, record.companyRegistrationNumber),
      )?.[1];
      if (supplier?.outcome === 'unavailable') unavailable = 'supplier-check-unavailable';
      if (supplier?.outcome !== 'found' || !('supplies' in supplier) || !supplier.supplies)
        continue;
      const declaredRefs = unique(declaring(record).map((c) => c.itemRef));
      flags.push(
        flag(
          'directorship-employer-supplier',
          'high',
          {
            companyRegistrationNumber: record.companyRegistrationNumber,
            role: record.role,
            declared: declaredRefs.length > 0,
          },
          declaredRefs.length > 0 ? declaredRefs : [statementRef(personKey)],
        ),
      );
    }
  }
  return { flags, notes, ...(unavailable ? { unavailable } : {}) };
}

/**
 * Company registration numbers in a declared text, in the BRS formats: `PVT-…`, `PUB-…`,
 * `CLG-…`, `LLP-…`, `BN-…`, `CPR/2015/123456` and `C.123456`.
 */
export function registrationNumbers(text: string): string[] {
  const pattern =
    /(?<![A-Z0-9])(?:(?:PVT|PUB|CLG|LLP|BN)-?[A-Z0-9]{6,}|CPR\/\d{4}\/\d+|C\.?\d{4,})(?![A-Z0-9])/gu;
  return [...text.toUpperCase().matchAll(pattern)].map(([number]) => number);
}

/** Whether a text carries an identifier, written with or without its separators. */
function mentionsIdentifier(text: string, identifier: string): boolean {
  const key = identifier.toUpperCase().replace(/[^A-Z0-9]/gu, '');
  if (key === '') return false;
  // Letters and digits only, so nothing to escape; any separators may sit between them.
  const spaced = key.replace(/(?<=.)(?=.)/gu, '[\\s/.,-]*');
  return new RegExp(`(?<![A-Z0-9])${spaced}(?![A-Z0-9])`, 'u').test(text.toUpperCase());
}

/** Names agree when they are the same once case, punctuation and "Limited", "Ltd" or "PLC" go. */
function sameCompanyName(a: string, b: string): boolean {
  const key = (name: string) => normalise(name).replace(/ (limited|ltd|plc)$/u, '');
  return key(a) !== '' && key(a) === key(b);
}

/**
 * KRA: a PIN for the ID, compliance, and annual income declared to KRA against the income
 * declared here, annualised over the statement's income period (≥ 25% medium, above 100% high).
 * A missing PIN is an indicator for the officer, and for a household member with income.
 */
function kra({ statement }: Person, result: KraResult): SystemMatch {
  const { personKey } = statement;
  const refs = [statementRef(personKey)];
  const taxpayers = result.outcome === 'found' ? result.taxpayers : [];
  if (taxpayers.length === 0) {
    const expected = personKey === 'officer' || statement.income.length > 0;
    return {
      flags: expected ? [flag('kra-pin-missing', 'medium', { pinPresent: false }, refs)] : [],
      notes: [],
    };
  }
  const flags: Flag[] = [];
  if (taxpayers.some((t) => t.compliance.status === 'non-compliant')) {
    flags.push(
      flag(
        'kra-non-compliant',
        'medium',
        { pinPresent: true, pins: taxpayers.length, complianceStatus: 'non-compliant' },
        refs,
      ),
    );
  }
  const mismatch = incomeMismatch(statement, taxpayers);
  if (mismatch) flags.push(mismatch);
  return { flags, notes: [] };
}

/** The length of an income period in years, by calendar months: 1 Nov 2025 to 1 Nov 2027 is 2. */
function periodYears({ from, to }: Statement['incomePeriod']): number {
  const [fromYear = 0, fromMonth = 0, fromDay = 0] = from.split('-').map(Number);
  const [toYear = 0, toMonth = 0, toDay = 0] = to.split('-').map(Number);
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth) + (toDay - fromDay) / 30.4375;
  return months / 12;
}

function incomeMismatch(statement: Statement, taxpayers: KraResult['taxpayers']): Flag | null {
  const incomes = taxpayers.flatMap((t) => t.compliance.annualIncomeDeclaredCents ?? []);
  const years = periodYears(statement.incomePeriod);
  if (incomes.length === 0 || !(years > 0)) return null;
  const toKra = incomes.reduce((sum, cents) => sum + cents, 0);
  const declared = statement.income.reduce((sum, item) => sum + item.amount.kesCents, 0) / years;
  if (toKra === 0 && declared === 0) return null;
  // Income to KRA with none declared here is more than any percentage, and there is none to give.
  const ratio = declared === 0 ? Infinity : Math.abs(toKra - declared) / declared;
  if (ratio < 0.25) return null;
  const refs =
    statement.income.length > 0
      ? statement.income.map((item) => ref({ personKey: statement.personKey, item }))
      : [statementRef(statement.personKey)];
  return flag(
    'kra-income-mismatch',
    ratio > 1 ? 'high' : 'medium',
    {
      differencePercent: Number.isFinite(ratio) ? Math.round(ratio * 100) : null,
      direction: toKra > declared ? 'above' : 'below',
    },
    refs,
  );
}

function statementRef(personKey: string): ItemRef {
  return { personKey, itemId: null, sectionKey: statementSectionKey(personKey) };
}

function unique<T>(values: T[]): T[] {
  return uniqueBy(values, (value) => JSON.stringify(value));
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}
