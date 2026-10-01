import type { AssetItem, DeclarationV1, Statement } from '@adili/forms';

import { normalise, statementSectionKey } from './match.js';
import type { RuleId, Severity } from './registry.js';
import { type Evidence, flag, type Flag, type ItemRef, ref } from './rules.js';

/*
 * The matching module's own inputs: what it reads of a registry's answer. The integration-gateway's
 * results (integration-gateway.yaml) carry these fields and more; the caller hands them over, so
 * the pure rules do not depend on the gateway's generated client.
 */

export interface KraTaxpayer {
  pin: string;
  registeredOn: string;
  compliance: {
    status: 'compliant' | 'non-compliant' | 'unknown';
    certificateNumber: string | null;
    validUntil: string | null;
    /** KES cents. */
    annualIncomeDeclaredCents: number | null;
  };
}

export interface NtsaVehicle {
  registrationNumber: string;
  make: string;
  model: string;
  yearOfManufacture: number;
  registeredOn: string;
}

export interface BrsDirectorship {
  companyRegistrationNumber: string;
  companyName: string;
  companyStatus: string;
  role: string;
  shares: number | null;
  appointedOn: string;
}

export interface ArdhisasaParcel {
  parcelNumber: string;
  county: string;
  areaHectares: number;
  tenure: string;
  registeredOn: string;
}

/** The records of a found lookup, as the gateway stores them (`StoredResult.payload`). */
export interface RegistryRecords {
  kra: { taxpayers: KraTaxpayer[] };
  ntsa: { vehicles: NtsaVehicle[] };
  brs: { directorships: BrsDirectorship[] };
  ardhisasa: { parcels: ArdhisasaParcel[] };
}

/** A registry's answer: found (with its records) or not, and the gateway's result id. */
export interface RegistryAnswer {
  outcome: 'found' | 'not-found';
  resultId: string;
}

export type KraResult = RegistryAnswer & RegistryRecords['kra'];
export type NtsaResult = RegistryAnswer & RegistryRecords['ntsa'];
export type BrsResult = RegistryAnswer & RegistryRecords['brs'];
export type ArdhisasaResult = RegistryAnswer & RegistryRecords['ardhisasa'];
/** Whether one of the officer's companies is on the employer's supplier list. */
export interface SupplierCheckResult extends RegistryAnswer {
  supplies: boolean | null;
}

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

type Directorship = BrsDirectorship;

/** A declared company is the registry's when it carries its registration number or exact name. */
function refersTo(company: DeclaredCompany, record: Directorship): boolean {
  return company.texts.some(
    (text) =>
      mentionsIdentifier(text, record.companyRegistrationNumber) ||
      sameCompanyName(text, record.companyName),
  );
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

/**
 * Annual income declared to KRA against the income declared here, annualised over the
 * statement's income period; null when there is nothing to compare. `ratio` is the difference
 * over the declared income, infinite when there is income to KRA and none declared here.
 */
function incomeDifference(
  statement: Statement,
  taxpayers: KraResult['taxpayers'],
): { ratio: number; direction: 'above' | 'below' } | null {
  const incomes = taxpayers.flatMap((t) => t.compliance.annualIncomeDeclaredCents ?? []);
  const years = periodYears(statement.incomePeriod);
  if (incomes.length === 0 || !(years > 0)) return null;
  const toKra = incomes.reduce((sum, cents) => sum + cents, 0);
  const declared = statement.income.reduce((sum, item) => sum + item.amount.kesCents, 0) / years;
  if (toKra === 0 && declared === 0) return null;
  // Income to KRA with none declared here is more than any percentage, and there is none to give.
  const ratio = declared === 0 ? Infinity : Math.abs(toKra - declared) / declared;
  return { ratio, direction: toKra > declared ? 'above' : 'below' };
}

const percent = (ratio: number) => (Number.isFinite(ratio) ? Math.round(ratio * 100) : null);

function incomeMismatch(statement: Statement, taxpayers: KraResult['taxpayers']): Flag | null {
  const difference = incomeDifference(statement, taxpayers);
  if (!difference || difference.ratio < 0.25) return null;
  const refs =
    statement.income.length > 0
      ? statement.income.map((item) => ref({ personKey: statement.personKey, item }))
      : [statementRef(statement.personKey)];
  return flag(
    'kra-income-mismatch',
    difference.ratio > 1 ? 'high' : 'medium',
    { differencePercent: percent(difference.ratio), direction: difference.direction },
    refs,
  );
}

/** The registry each registry rule compares with: which flags belong to a system's check. */
export const REGISTRY_RULE_SYSTEMS = {
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
} as const satisfies Partial<Record<RuleId, RegistrySystem>>;

export type RegistryRuleId = keyof typeof REGISTRY_RULE_SYSTEMS;
export const REGISTRY_RULE_IDS = Object.keys(REGISTRY_RULE_SYSTEMS) as RegistryRuleId[];

/** The registry a flag's rule compares with; null for a deterministic rule's flag. */
export function registrySystemOf(ruleId: string): RegistrySystem | null {
  return Object.hasOwn(REGISTRY_RULE_SYSTEMS, ruleId)
    ? REGISTRY_RULE_SYSTEMS[ruleId as RegistryRuleId]
    : null;
}

/** review.yaml `RegistryView` row relation. */
export type RegistryRelation = 'matched' | 'not-declared' | 'not-in-registry';

/**
 * A registry record beside the declared item it matched (`matched`), a record no item declares
 * (`not-declared`), or a declared identifier the registry does not hold (`not-in-registry`, the
 * record is then that identifier alone).
 */
export interface RegistryRow {
  registryRecord: Record<string, unknown>;
  declaredItemId: string | null;
  relation: RegistryRelation;
}

/**
 * The Registry tab's rows of one person and registry: the records pulled from the gateway paired
 * with the declared items as `matchRegistries` pairs them. KRA records show PIN presence,
 * compliance and its validity, and the income difference as a percentage, never an amount.
 */
export function registryRows<S extends RegistrySystem>(
  document: DeclarationV1,
  personKey: string,
  system: S,
  records: RegistryRecords[S],
): RegistryRow[] {
  const statement = document.statements.find((s) => s.personKey === personKey);
  if (!statement) return [];
  switch (system) {
    case 'ardhisasa':
      return identifierRows(statement, {
        types: ['land', 'building'],
        identifier: (item) => item.details?.parcelNumber,
        registry: (records as RegistryRecords['ardhisasa']).parcels,
        idOf: (parcel) => parcel.parcelNumber,
        key: 'parcelNumber',
      });
    case 'ntsa':
      return identifierRows(statement, {
        types: ['vehicle'],
        identifier: (item) => item.details?.registration,
        registry: (records as RegistryRecords['ntsa']).vehicles,
        idOf: (vehicle) => vehicle.registrationNumber,
        key: 'registrationNumber',
      });
    case 'brs':
      return companyRows(
        { statement, document },
        (records as RegistryRecords['brs']).directorships,
      );
    default:
      return kraRows(statement, (records as RegistryRecords['kra']).taxpayers);
  }
}

function identifierRows<R extends object>(
  statement: Statement,
  rule: {
    types: AssetItem['type'][];
    identifier: (item: AssetItem) => string | undefined;
    registry: R[];
    idOf: (record: R) => string;
    key: string;
  },
): RegistryRow[] {
  const declared = statement.assets
    .filter((item) => rule.types.includes(item.type))
    .flatMap((item) => {
      const identifier = rule.identifier(item)?.trim();
      return identifier ? [{ item, identifier }] : [];
    });
  const registry = uniqueBy(rule.registry, (record) => identifierKey(rule.idOf(record)));
  return [
    ...registry.map((record): RegistryRow => {
      const match = declared.find((d) => sameIdentifier(d.identifier, rule.idOf(record)));
      return {
        registryRecord: Object.fromEntries(Object.entries(record)),
        declaredItemId: match?.item.id ?? null,
        relation: match ? 'matched' : 'not-declared',
      };
    }),
    ...declared
      .filter(({ identifier }) => !registry.some((r) => sameIdentifier(rule.idOf(r), identifier)))
      .map(({ item, identifier }): RegistryRow => ({
        registryRecord: { [rule.key]: identifier },
        declaredItemId: item.id,
        relation: 'not-in-registry',
      })),
  ];
}

function companyRows(person: Person, directorships: Directorship[]): RegistryRow[] {
  const declared = declaredCompanies(person);
  const registry = uniqueBy(directorships, (d) => identifierKey(d.companyRegistrationNumber));
  return [
    ...registry.map((record): RegistryRow => {
      const declaring = declared.filter((company) => refersTo(company, record));
      return {
        registryRecord: { ...record },
        declaredItemId: declaring.find((c) => c.itemRef.itemId !== null)?.itemRef.itemId ?? null,
        relation: declaring.length > 0 ? 'matched' : 'not-declared',
      };
    }),
    ...declared
      .filter((company) => company.checkable)
      .flatMap((company) =>
        unique(company.texts.flatMap(registrationNumbers))
          .filter((n) => !registry.some((r) => sameIdentifier(r.companyRegistrationNumber, n)))
          .map((number): RegistryRow => ({
            registryRecord: { companyRegistrationNumber: number },
            declaredItemId: company.itemRef.itemId,
            relation: 'not-in-registry',
          })),
      ),
  ];
}

function kraRows(statement: Statement, taxpayers: KraResult['taxpayers']): RegistryRow[] {
  const difference = incomeDifference(statement, taxpayers);
  return taxpayers.map((taxpayer) => ({
    registryRecord: {
      pinPresent: true,
      complianceStatus: taxpayer.compliance.status,
      validUntil: taxpayer.compliance.validUntil,
      incomeDifferencePercent: difference ? percent(difference.ratio) : null,
      incomeDirection: difference?.direction ?? null,
    },
    declaredItemId: null,
    relation: 'matched',
  }));
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
