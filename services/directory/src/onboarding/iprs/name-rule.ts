import type { IprsPerson } from './iprs-lookup.js';

/**
 * The confirm step's name rule (spec 03): names are upper-cased, stripped of punctuation and
 * split on whitespace; every IPRS name token except the middle name's must be among the roster
 * full name's tokens. Rosters often leave out or abbreviate middle names, and order names
 * differently, so neither the middle name nor the order counts.
 *
 * @example
 * namesMatch({ firstName: 'Wanjiru', middleName: 'Achieng', lastName: "O'Tieno" }, 'OTIENO Wanjiru'); // true
 */
export function namesMatch(iprs: IprsPerson, rosterFullName: string): boolean {
  const roster = new Set(nameTokens(rosterFullName));
  const required = [...nameTokens(iprs.firstName), ...nameTokens(iprs.lastName)];
  return required.length > 0 && required.every((token) => roster.has(token));
}

/**
 * Upper-cased tokens of a name. Punctuation is removed rather than turned into a space, so
 * `O'Tieno` is `OTIENO` and `Wa-Njeri` is `WANJERI`; letters of any script and digits are kept.
 */
export function nameTokens(name: string): string[] {
  return name
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
}
