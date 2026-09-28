import { COUNTIES } from '@adili/forms';

import {
  companyNameMatchKey,
  companyNumberMatchKey,
  kraPinMatchKey,
  parcelMatchKey,
  registrationMatchKey,
} from './match-keys.js';
import type {
  ArdhisasaParcel,
  ArdhisasaResult,
  BrsDirectorship,
  BrsResult,
  KraResult,
  KraTaxpayer,
  NtsaResult,
  NtsaVehicle,
  RegistryResult,
} from './registry-results.js';

/**
 * Pure mapping from the gateway's verification results to suggestions (spec 05b, S3): what a
 * registry holds about one person becomes the item fields the declarant can add with one tap.
 *
 * Field names per item type are the ones the portal reads (`suggestions.ts` in the portal):
 * - `vehicle` (NTSA): registration, make, model, year
 * - `land` (ArdhiSasa): parcelNumber, size, location, county (a declaration.v1 county code)
 * - `shareholding` (BRS; the spec's `investment`, which declaration.v1 does not have):
 *   companyName, registrationNumber, role, shares
 * - `bio-tax` (KRA): kraPin, complianceStatus
 * - `income-hint` (KRA): incomeType only; the declared income travels in `sourceRef` as a hint
 * Every statement item also carries a `description` the declarant can edit before adding.
 *
 * Value fields (`value`, `amount`) are never set: valuing an asset is the declarant's call.
 * A registry record with a blank field simply omits it (partial records); a result that is not
 * `found` maps to no suggestions.
 */

/** Where a suggestion lands: a person's financial statement, the bio, or the household. */
export type SuggestionSectionKey = 'bio' | 'household' | `statement:${string}`;

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

export interface BioTaxFields {
  kraPin: string;
  complianceStatus: KraTaxpayer['compliance']['status'];
}

export interface IncomeHintFields {
  incomeType: 'salary-emoluments';
}

interface Proposed<TType extends string, TFields> {
  sectionKey: SuggestionSectionKey;
  itemType: TType;
  fields: TFields;
  /** The registry's identifier for the record plus facts that do not become item fields. */
  sourceRef: Record<string, string | number>;
  /** Normalised identifiers to compare with existing items (see `match-keys.ts`). */
  matchKeys: string[];
}

export type MappedSuggestion =
  | Proposed<'vehicle', VehicleFields>
  | Proposed<'land', LandFields>
  | Proposed<'shareholding', ShareholdingFields>
  | Proposed<'bio-tax', BioTaxFields>
  | Proposed<'income-hint', IncomeHintFields>;

/** A person's key as declaration.v1 stores it: `officer`, `spouse:<uuid>` or `child:<uuid>`. */
export type PersonKey = string;

/** The suggestions a registry result yields for the person it was looked up for. */
export function mapRegistryResult(
  result: RegistryResult,
  personKey: PersonKey,
): MappedSuggestion[] {
  if (result.outcome !== 'found') return [];
  switch (result.system) {
    case 'kra':
      return mapKraResult(result, personKey);
    case 'ntsa':
      return mapNtsaResult(result, personKey);
    case 'brs':
      return mapBrsResult(result, personKey);
    case 'ardhisasa':
      return mapArdhisasaResult(result, personKey);
  }
}

/** NTSA: each vehicle registered to the person → a `vehicle` asset. */
export function mapNtsaResult(result: NtsaResult, personKey: PersonKey): MappedSuggestion[] {
  if (result.outcome !== 'found') return [];
  return result.vehicles.flatMap((vehicle) => {
    const suggestion = mapVehicle(vehicle, personKey);
    return suggestion ? [suggestion] : [];
  });
}

function mapVehicle(vehicle: NtsaVehicle, personKey: PersonKey): MappedSuggestion | null {
  const registration = text(vehicle.registrationNumber);
  const make = text(vehicle.make);
  const model = text(vehicle.model);
  const year = wholeNumber(vehicle.yearOfManufacture);
  if (!registration && !make && !model) return null;
  const makeModel = joined([make, model], ' ');
  return {
    sectionKey: statementSection(personKey),
    itemType: 'vehicle',
    fields: compact({
      description: makeModel || (registration ? `Vehicle ${registration}` : 'Vehicle'),
      registration,
      make,
      model,
      year,
    }),
    sourceRef: compact({ registration, registeredOn: text(vehicle.registeredOn) }),
    matchKeys: keys(registration && registrationMatchKey(registration)),
  };
}

/** ArdhiSasa: each parcel registered to the person → a `land` asset. */
export function mapArdhisasaResult(
  result: ArdhisasaResult,
  personKey: PersonKey,
): MappedSuggestion[] {
  if (result.outcome !== 'found') return [];
  return result.parcels.flatMap((parcel) => {
    const suggestion = mapParcel(parcel, personKey);
    return suggestion ? [suggestion] : [];
  });
}

function mapParcel(parcel: ArdhisasaParcel, personKey: PersonKey): MappedSuggestion | null {
  const parcelNumber = text(parcel.parcelNumber);
  if (!parcelNumber) return null;
  const countyText = text(parcel.county);
  const county = countyCode(countyText);
  const countyName = county ? COUNTIES.find((each) => each.code === county)?.name : undefined;
  const hectares = positiveNumber(parcel.areaHectares);
  return {
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
    matchKeys: keys(parcelMatchKey(parcelNumber)),
  };
}

/**
 * BRS: each company the person directs or holds shares in → a `shareholding` asset (role and
 * shares as BRS records them; shares omitted when BRS holds none). Registrable-interest
 * directorships in paragraph 9 stay the declarant's to enter.
 */
export function mapBrsResult(result: BrsResult, personKey: PersonKey): MappedSuggestion[] {
  if (result.outcome !== 'found') return [];
  return result.directorships.flatMap((directorship) => {
    const suggestion = mapDirectorship(directorship, personKey);
    return suggestion ? [suggestion] : [];
  });
}

function mapDirectorship(
  directorship: BrsDirectorship,
  personKey: PersonKey,
): MappedSuggestion | null {
  const companyName = text(directorship.companyName);
  const registrationNumber = text(directorship.companyRegistrationNumber);
  if (!companyName && !registrationNumber) return null;
  return {
    sectionKey: statementSection(personKey),
    itemType: 'shareholding',
    fields: compact({
      description: `Shares in ${companyName || registrationNumber}`,
      companyName,
      registrationNumber,
      role: text(directorship.role),
      shares: nonNegativeNumber(directorship.shares),
    }),
    sourceRef: compact({
      registrationNumber,
      companyStatus: text(directorship.companyStatus),
      appointedOn: text(directorship.appointedOn),
    }),
    matchKeys: keys(
      registrationNumber && companyNumberMatchKey(registrationNumber),
      companyName && companyNameMatchKey(companyName),
    ),
  };
}

/**
 * KRA: each PIN → `bio-tax` (PIN and compliance) in the bio for the officer or the household for
 * a spouse; children's PINs have no place in declaration.v1 and are not suggested. Where KRA
 * returns declared income, an `income-hint` for the person's statement carries it in
 * `sourceRef` (a hint to check the salary item, never a value).
 */
export function mapKraResult(result: KraResult, personKey: PersonKey): MappedSuggestion[] {
  if (result.outcome !== 'found') return [];
  return result.taxpayers.flatMap((taxpayer) => mapTaxpayer(taxpayer, personKey));
}

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
      matchKeys: keys(kraPinMatchKey(kraPin)),
    });
  }
  const declaredIncome = nonNegativeInteger(compliance.annualIncomeDeclaredCents);
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

function statementSection(personKey: PersonKey): SuggestionSectionKey {
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

function joined(parts: string[], separator: string) {
  return parts.filter((part) => part !== '').join(separator);
}

function wholeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function keys(...candidates: (string | null | undefined)[]): string[] {
  return candidates.filter((each): each is string => typeof each === 'string' && each !== '');
}

/** Drops empty strings and undefined so a partial record leaves its fields out. */
function compact<T extends Record<string, unknown>>(
  record: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== ''),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}
