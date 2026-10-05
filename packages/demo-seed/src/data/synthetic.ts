import { createHash } from 'node:crypto';

import { COUNTIES } from '@adili/forms';

import { jsonBody, requestJson } from '../clients/http.js';
import type { SeedContext } from '../context.js';
import { DEMO_COMMISSIONS, commissionIndex } from './commissions.js';
import type { Holdings } from './declaration.js';
import { CURRENT_CYCLE, PREVIOUS_CYCLE } from './personas.js';
import type { RosterRow } from './roster.js';

/** A synthetic officer as the mocks generated it (`mocks/demo/synthetic.py`). */
export interface SyntheticOfficer extends RosterRow {
  dateOfBirth: string;
  placeOfBirth: string;
  sex: string;
  kraPin: string;
  taxCompliant: boolean;
  annualIncomeKes: number;
  holdings: {
    kind: 'vehicle' | 'parcel' | 'company';
    reference: string;
    description: string;
    registeredOn: string;
    valueKes: number;
    /** Parcels: the county name and area (hectares) ArdhiSasa holds; empty for the rest. */
    county: string;
    areaHectares: string;
  }[];
}

/** The seed the mocks generate from: changing it changes every synthetic officer. */
const GENERATOR_SEED = 'adili-demo-2026';

/** How many synthetic officers a Commission gets for the configured volume. */
export function volumeOf(context: SeedContext, slug: string): number {
  const commission = DEMO_COMMISSIONS[commissionIndex(slug)];
  return Math.round(context.config.DEMO_SEED_VOLUME * (commission?.volumeShare ?? 0));
}

/**
 * The synthetic officers of every volume Commission, created in the mocks (IPRS, KRA, HR and the
 * registries) if they are not there yet. Deterministic, so every step that asks gets the same
 * people.
 */
export async function syntheticOfficers(
  context: SeedContext,
): Promise<Map<string, SyntheticOfficer[]>> {
  return (await syntheticGeneration(context)).officers;
}

/** The synthetic officers, and how many the mocks did not hold before this run asked. */
export function syntheticGeneration(
  context: SeedContext,
): Promise<{ created: number; officers: Map<string, SyntheticOfficer[]> }> {
  return context.memo('synthetic-officers', async () => {
    const commissions = DEMO_COMMISSIONS.filter((c) => volumeOf(context, c.slug) > 0).map((c) => ({
      slug: c.slug,
      index: commissionIndex(c.slug),
      count: volumeOf(context, c.slug),
      employerCode: c.employerCode,
      reportingEntity: c.reportingEntity,
      emailDomain: c.emailDomain,
    }));
    if (commissions.length === 0) return { created: 0, officers: new Map() };
    const { body } = await requestJson<{
      created: number;
      officers: Record<string, SyntheticOfficer[]>;
    }>(`${context.config.MOCKS_URL}/demo/synthetic-officers`, {
      method: 'POST',
      ...jsonBody({ seed: GENERATOR_SEED, anchor: context.config.DEMO_SEED_ANCHOR, commissions }),
      what: 'create synthetic officers in the mocks',
    });
    return { created: body.created, officers: new Map(Object.entries(body.officers)) };
  });
}

/** The mocks' county names the declaration form spells otherwise. */
const COUNTY_ALIASES: Readonly<Record<string, string>> = { Nairobi: 'Nairobi City' };

/** The declaration form's code for a county the mocks name, e.g. `Kisumu` is `042`. */
function countyCode(name: string): string {
  const formName = COUNTY_ALIASES[name] ?? name;
  const county = COUNTIES.find((candidate) => candidate.name === formName);
  if (!county) throw new Error(`Unknown county ${name}`);
  return county.code;
}

/** A number in [0, 1) fixed by the officer and a purpose, so behaviour never changes per run. */
function draw(officer: SyntheticOfficer, purpose: string): number {
  return (
    createHash('sha256').update(`${officer.nationalId}:${purpose}`).digest().readUInt32BE(0) /
    2 ** 32
  );
}

/** What a synthetic officer does in the demo: mostly files, a minority does not. */
export interface Behaviour {
  filesPrevious: boolean;
  filesCurrent: boolean;
  filesInitial: boolean;
  /** Leaves their newest registry holding out of the current declaration (a 07b flag). */
  omitsHolding: boolean;
}

export function behaviourOf(officer: SyntheticOfficer): Behaviour {
  return {
    filesPrevious: draw(officer, 'previous') < 0.96,
    filesCurrent: draw(officer, 'current') < 0.86,
    filesInitial: draw(officer, 'initial') < 0.8,
    omitsHolding: draw(officer, 'omits') < 0.05,
  };
}

/** The statement date of a demo cycle (the demo policy's 30 June). */
export function cycleStatementDate(cycle: number): string {
  return `${String(cycle)}-06-30`;
}

/**
 * What the officer declares for a statement date: the registry holdings registered by then (so a
 * holding registered between the cycles is a change), the salary for the period, and for the
 * current cycle of an officer who omits one, all but the newest holding.
 */
export function holdingsOf(
  officer: SyntheticOfficer,
  statementDate: string,
  cycle: number | null,
): Holdings {
  let held = officer.holdings.filter((h) => h.registeredOn <= statementDate);
  if (cycle === CURRENT_CYCLE && behaviourOf(officer).omitsHolding && held.length > 0) {
    const newest = held.reduce((a, b) => (a.registeredOn >= b.registeredOn ? a : b));
    held = held.filter((h) => h !== newest);
  }
  const years = cycle === null ? 1 : 2;
  const raise = cycle === PREVIOUS_CYCLE || cycle === null ? 1 : 1.08;
  return {
    salaryKes: Math.round(officer.annualIncomeKes * years * raise),
    employer: officer.reportingEntity,
    vehicles: held
      .filter((h) => h.kind === 'vehicle')
      .map((h) => ({ registration: h.reference, makeModel: h.description, valueKes: h.valueKes })),
    parcels: held
      .filter((h) => h.kind === 'parcel')
      .map((h) => ({
        parcelNumber: h.reference,
        description: h.description,
        size: `${h.areaHectares} ha`,
        county: countyCode(h.county),
        valueKes: h.valueKes,
      })),
    companies: held
      .filter((h) => h.kind === 'company')
      .map((h) => ({
        name: h.description,
        role: 'Director and shareholder',
        valueKes: h.valueKes,
      })),
    loans: [],
  };
}
