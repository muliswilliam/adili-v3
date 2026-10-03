import {
  COUNTIES,
  type DeclarationSectionKey,
  type ItemSource,
  type PersonKey,
} from '@adili/forms';

import {
  companyNameMatchKey,
  companyNumberMatchKey,
  kraPinMatchKey,
  type MatchKey,
  matchKeysFor,
  presentKeys,
} from './match-keys.js';
import type {
  ArdhisasaParcel,
  BrsDirectorship,
  KraTaxpayer,
  NtsaVehicle,
  RegistryResult,
  RegistrySystem,
} from './registry-results.js';

/**
 * Pure mapping from the gateway's verification results to suggestions (spec 05b, S3): what a
 * registry holds about one person becomes the item fields the declarant can add with one tap.
 *
 * Field names per item type are the portal's vocabulary, not declaration.v1 `details`: accepting
 * a suggestion translates them into the item in the service (`acceptance.ts`). The contract's `Suggestion.fields` is free-form; the keys are:
 * - `vehicle` (NTSA): registration, make, model, year
 * - `land` (ArdhiSasa): parcelNumber, size, location, county (a declaration.v1 county code)
 * - `shareholding` (BRS, a holding of shares; the spec's `investment`, which declaration.v1 does
 *   not have): companyName, registrationNumber, role, shares
 * - `directorship` (BRS, the declarant's directorship; a paragraph 9 registrable interest):
 *   companyName, role. Whether it is remunerated stays the declarant's to say.
 * - `bio-tax` (KRA): kraPin, complianceStatus
 * - `income-hint` (KRA): incomeType only; the declared income travels in `sourceRef` as a hint
 * Every statement item also carries a `description` the declarant can edit before adding.
 *
 * Value fields (`value`, `amount`) are never set: valuing an asset is the declarant's call.
 * A registry record with a blank field simply omits it (partial records); a record without its
 * identifier, and a result that is not `found`, map to no suggestions.
 *
 * The registry's identifiers (registration, parcel number, company number, KRA PIN) go into
 * `sourceRef` with the facts that do not become item fields, and into `matchKeys` for duplicate
 * detection against the person's items.
 */

export interface VehicleFields {
  description?: string;
  registration?: string;
  make?: string;
  model?: string;
  year?: number;
}

export interface LandFields {
  description?: string;
  parcelNumber?: string;
  size?: string;
  /** Free-text location, used when the registry's county is not one of the 47 codes. */
  location?: string;
  county?: string;
}

export interface ShareholdingFields {
  description?: string;
  companyName?: string;
  registrationNumber?: string;
  role?: string;
  shares?: number;
}

export interface DirectorshipFields {
  companyName: string;
  role: string;
}

export interface BioTaxFields {
  kraPin: string;
  complianceStatus: KraTaxpayer['compliance']['status'];
}

export interface IncomeHintFields {
  incomeType: 'salary-emoluments';
}

interface Proposed<TType extends string, TFields> {
  /** Where the suggestion lands: a person's financial statement, the bio, household or other. */
  sectionKey: DeclarationSectionKey;
  itemType: TType;
  fields: TFields;
  /** The registry's identifier for the record plus facts that do not become item fields. */
  sourceRef: Record<string, string | number>;
  /** Normalised identifiers to compare with existing items (see `match-keys.ts`). */
  matchKeys: MatchKey[];
}

export type MappedSuggestion =
  | Proposed<'vehicle', VehicleFields>
  | Proposed<'land', LandFields>
  | Proposed<'shareholding', ShareholdingFields>
  | Proposed<'directorship', DirectorshipFields>
  | Proposed<'bio-tax', BioTaxFields>
  | Proposed<'income-hint', IncomeHintFields>;

/**
 * The suggestions one registry result yields for one person, with the result they came from: the
 * declarations service keeps these on the suggestion set (`SuggestionSet.source`, `status`,
 * `verificationResultId`), and an accepted item's `source` (declaration.v1 `ItemSource`, whose
 * `kind` is the registry) records them. `checkedAt` is when the registry answered, for "from KRA,
 * checked on …".
 */
export interface MappedSuggestionSet {
  source: RegistrySystem & ItemSource['kind'];
  /** `ready` when the registry answered (found or not found); `unavailable` when it did not. */
  status: 'ready' | 'unavailable';
  verificationResultId: string;
  checkedAt: string;
  suggestions: MappedSuggestion[];
}

/**
 * The suggestions a registry result yields for the person it was looked up for. A result that is
 * not `found` yields none, even if it carries records.
 */
export function mapRegistryResult(
  result: RegistryResult,
  personKey: PersonKey,
): MappedSuggestionSet {
  return {
    source: result.system,
    status: result.outcome === 'unavailable' ? 'unavailable' : 'ready',
    verificationResultId: result.resultId,
    checkedAt: result.checkedAt,
    suggestions: result.outcome === 'found' ? suggestionsOf(result, personKey) : [],
  };
}

function suggestionsOf(result: RegistryResult, personKey: PersonKey): MappedSuggestion[] {
  switch (result.system) {
    case 'kra':
      return result.taxpayers.flatMap((taxpayer) => mapTaxpayer(taxpayer, personKey));
    case 'ntsa':
      return result.vehicles.flatMap((vehicle) => mapVehicle(vehicle, personKey));
    case 'brs':
      return result.directorships.flatMap((record) => mapDirectorship(record, personKey));
    case 'ardhisasa':
      return result.parcels.flatMap((parcel) => mapParcel(parcel, personKey));
  }
}

/** NTSA: each vehicle registered to the person → a `vehicle` asset. */
function mapVehicle(vehicle: NtsaVehicle, personKey: PersonKey): MappedSuggestion[] {
  const registration = text(vehicle.registrationNumber);
  if (!registration) return [];
  const make = text(vehicle.make);
  const model = text(vehicle.model);
  const makeModel = [make, model].filter(Boolean).join(' ');
  return [
    {
      sectionKey: statementSection(personKey),
      itemType: 'vehicle',
      fields: compact({
        description: makeModel || `Vehicle ${registration}`,
        registration,
        make,
        model,
        year: positive(wholeNumber(vehicle.yearOfManufacture)),
      }),
      sourceRef: compact({ registration, registeredOn: text(vehicle.registeredOn) }),
      matchKeys: matchKeysFor('vehicle', registration),
    },
  ];
}

/** ArdhiSasa: each parcel registered to the person → a `land` asset. */
function mapParcel(parcel: ArdhisasaParcel, personKey: PersonKey): MappedSuggestion[] {
  const parcelNumber = text(parcel.parcelNumber);
  if (!parcelNumber) return [];
  const countyText = text(parcel.county);
  const county = countyCode(countyText);
  const countyName = county ? COUNTIES.find((each) => each.code === county)?.name : undefined;
  const hectares = positive(parcel.areaHectares);
  return [
    {
      sectionKey: statementSection(personKey),
      itemType: 'land',
      fields: compact({
        description: countyName ? `Land in ${countyName}` : `Land parcel ${parcelNumber}`,
        parcelNumber,
        size: hectares === undefined ? undefined : `${formatHectares(hectares)} ha`,
        location: county ? undefined : countyText,
        county,
      }),
      sourceRef: compact({
        parcelNumber,
        tenure: text(parcel.tenure),
        registeredOn: text(parcel.registeredOn),
      }),
      matchKeys: matchKeysFor('land', parcelNumber),
    },
  ];
}

/**
 * BRS: a record of the person in a company. Shares held → a `shareholding` asset in the person's
 * statement. A director's role → for the declarant, a `directorship` registrable interest
 * (paragraph 9); declaration.v1 records no directorships for a spouse or child. A record can
 * yield both; one with neither shares nor a director's role (or no company) yields none.
 */
function mapDirectorship(record: BrsDirectorship, personKey: PersonKey): MappedSuggestion[] {
  const companyName = text(record.companyName);
  const registrationNumber = text(record.companyRegistrationNumber);
  if (!companyName && !registrationNumber) return [];
  const role = text(record.role);
  const shares = positive(record.shares);
  const sourceRef = compact({
    registrationNumber,
    companyStatus: text(record.companyStatus),
    appointedOn: text(record.appointedOn),
  });
  // Items name the company in `details.issuer` or a directorship's `company`, by name or number.
  const matchKeys = presentKeys(
    companyNameMatchKey(companyName),
    companyNumberMatchKey(registrationNumber),
  );
  const suggestions: MappedSuggestion[] = [];
  if (shares !== undefined) {
    suggestions.push({
      sectionKey: statementSection(personKey),
      itemType: 'shareholding',
      fields: compact({
        description: `Shares in ${companyName || registrationNumber}`,
        companyName,
        registrationNumber,
        role,
        shares,
      }),
      sourceRef,
      matchKeys,
    });
  }
  // The registrable interest names the company, so a nameless record cannot become one.
  if (personKey === 'officer' && companyName && isDirectorRole(role)) {
    suggestions.push({
      sectionKey: 'other',
      itemType: 'directorship',
      fields: { companyName, role },
      sourceRef,
      matchKeys,
    });
  }
  return suggestions;
}

/** "Director", "Managing Director", "Alternate director"; not "Shareholder" or "Secretary". */
function isDirectorRole(role: string) {
  return /\bdirector\b/i.test(role);
}

/**
 * KRA: each PIN → `bio-tax` (PIN and compliance) in the bio for the declarant or the household for
 * a spouse; children's PINs have no place in declaration.v1 and are not suggested. Where KRA
 * returns declared income, an `income-hint` for the person's statement carries it in
 * `sourceRef` (a hint to check the salary item, never a value).
 */
function mapTaxpayer(taxpayer: KraTaxpayer, personKey: PersonKey): MappedSuggestion[] {
  const kraPin = text(taxpayer.pin).toUpperCase();
  if (!kraPin) return [];
  const { compliance } = taxpayer;
  const suggestions: MappedSuggestion[] = [];
  const bioSection = personKey === 'officer' ? 'bio' : isSpouse(personKey) ? 'household' : null;
  if (bioSection) {
    suggestions.push({
      sectionKey: bioSection,
      itemType: 'bio-tax',
      fields: { kraPin, complianceStatus: compliance.status },
      sourceRef: compact({
        kraPin,
        registeredOn: text(taxpayer.registeredOn),
        certificateNumber: text(compliance.certificateNumber),
        validUntil: text(compliance.validUntil),
      }),
      matchKeys: presentKeys(kraPinMatchKey(kraPin)),
    });
  }
  const declaredIncome = wholeNumber(compliance.annualIncomeDeclaredCents);
  if (declaredIncome !== undefined) {
    suggestions.push({
      sectionKey: statementSection(personKey),
      itemType: 'income-hint',
      fields: { incomeType: 'salary-emoluments' },
      sourceRef: { kraPin, annualIncomeDeclaredKesCents: declaredIncome },
      matchKeys: [],
    });
  }
  return suggestions;
}

function statementSection(personKey: PersonKey): DeclarationSectionKey {
  return `statement:${personKey}`;
}

function isSpouse(personKey: PersonKey) {
  return personKey.startsWith('spouse:');
}

/**
 * The declaration.v1 county code for a registry's county: a three-digit code as is, or a name
 * compared without case, spaces or punctuation ("Nairobi City", "nairobi", "Taita Taveta").
 */
export function countyCode(county: string): string | undefined {
  const trimmed = county.trim();
  if (/^\d{3}$/.test(trimmed)) {
    return COUNTIES.some((each) => each.code === trimmed) ? trimmed : undefined;
  }
  const wanted = countyKey(trimmed);
  if (!wanted) return undefined;
  return COUNTIES.find((each) => countyKey(each.name) === wanted)?.code;
}

function countyKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\bcounty\b/g, '')
    .replace(/\bcity\b/g, '')
    .replace(/[^a-z]/g, '');
}

/** 0.2 → "0.2", 1.25 → "1.25", 2 → "2": up to four decimals, no trailing zeros. */
function formatHectares(hectares: number) {
  return String(Number(hectares.toFixed(4)));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A finite number above zero, else undefined. */
function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A whole number of zero or more, else undefined. */
function wholeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Drops empty strings and undefined so a partial record leaves its fields out. */
function compact<T extends Record<string, unknown>>(
  record: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== ''),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}
