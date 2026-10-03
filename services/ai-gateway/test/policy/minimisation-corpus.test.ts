import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { minimise } from '../../src/policy/minimisation.js';

/**
 * The review corpus of PR #506 (#314 review rounds 4 to 18): each probe is a document's pages, the
 * name words that must not be sent (in any case, tokens aside) and the text that must stay as it
 * is. A change that leaks a name or hides a field again fails here.
 */
interface Probe {
  id: string;
  input: string | string[];
  mustHide: string[];
  mustKeep: string[];
}

const probes = JSON.parse(
  readFileSync(new URL('fixtures/minimisation-probes.json', import.meta.url), 'utf8'),
) as Probe[];

/**
 * Probes known to fail, and why: the trade-offs this reader makes by design and the long tail
 * tracked on #504. A probe here that starts passing fails the suite, so the list stays true.
 */
const EXPECTED_FAILURES: Readonly<Record<string, string>> = {
  'r18-std-15':
    'trade-off: one word before an item field reads as an item ("(a) Achieng Shares 500"), so the name is sent',
  'r18-std-16': '#504: a month that is also a surname is tokenised in a date ("3 March 2020")',
  'r18-std-25': '#504: a common word that is a name ("Grace") is matched only as written',
  'r18-std-27':
    '#504: a list line led by a common word that is a name ("Grace Fielder") is not read as a name',
  'r18-spec-34': '#504: a common word that is a name ("Grace") is matched only as written',
  'r18-spec-47': '#504: a common word that is a name ("Grace") is matched only as written',
  'r18-spec-36': '#504: a mixed "Assets:" list',
  'r18-spec-46': '#504: a date after "Signed on" is tokenised',
  'r18-spec-50': '#504: a date or place after "Signed at" / "Witnessed on" is tokenised',
  'r18-spec-51': '#504: a date or place after "Signed at" / "Witnessed on" is tokenised',
  'r18-spec-52': '#504: a date or place after "Signed at" / "Witnessed on" is tokenised',
  'r18-spec-53': '#504: a date or place after "Signed at" / "Witnessed on" is tokenised',
  'r19-std-8': '#504: a list under a label that names no party ("Vehicles:") is not read',
  'r19-std-20': '#504: an unlabelled list ("(a) Ana Prado") is not read',
  'r19-spec-23': '#504: a share class that is a surname ("Mary Ordinary") ends the name',
  'r19-spec-49': '#504: a share class that is a surname ("Mary Ordinary") ends the name',
  'r19-spec-48':
    '#504: a vehicle model that is also the owner\'s surname ("Toyota Prado", "Ana Prado") is hidden in the vehicle field',
  'r19-spec-55':
    '#504: a vehicle model that is also the owner\'s surname ("Prado", "Ana Prado") is hidden in the vehicle field',
  'r20-spec-9': '#504: a party wrapped onto the next line after a shape and a joiner is not read',
  'r20-spec-10': '#504: a party wrapped onto the next line after a shape and a joiner is not read',
  'r20-spec-51': '#504: a party wrapped onto the next line after a shape and a joiner is not read',
  'r20-spec-15':
    '#504: a second party on the next line after an address, with no joiner, is not read',
  'r20-spec-16': '#504: a second party named after a place ("Kericho Langat") hides the place',
  'r20-spec-19':
    '#504: a first name that is a place ("Kenya") after a shape is read as the address\'s',
  'r20-spec-41':
    '#504: a letter\'s addressee ("To:") and signature ("Yours faithfully,") are not read',
  'r20-spec-45': '#504: "Next of Kin:" is not a label',
  'r20-spec-46': '#504: "Nominee(s):" is not a label',
  'r20-spec-47': '#504: "Nominee(s):" is not a label',
  'r20-spec-48': '#504: the second party of "certify that X and Y" is not read',
  'r20-spec-84': '#504: the second party of "certify that X and Y" is not read',
  'r20-spec-91':
    '#504: an organisation\'s words are hidden as names wherever they recur ("Stima" in "Sacco: Stima Sacco")',
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anyCase = (word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, 'iu');

/** The pages as sent, joined, with tokens blanked so a token's class is no name word. */
function sent(input: string | string[]): string {
  const pages = (Array.isArray(input) ? input : [input]).map((textLayer, index) => ({
    page: index + 1,
    textLayer,
  }));
  const { input: minimised } = minimise({ document: { pages } });
  return minimised.document.pages.map(({ textLayer }) => textLayer).join('\n<PAGE>\n');
}

describe('minimise a document: the review corpus', () => {
  it('names every expected failure after a probe in the corpus', () => {
    const ids = new Set(probes.map(({ id }) => id));
    expect(Object.keys(EXPECTED_FAILURES).filter((id) => !ids.has(id))).toEqual([]);
  });

  for (const { id, input, mustHide, mustKeep } of probes) {
    const reason = EXPECTED_FAILURES[id];
    const run = reason === undefined ? it : it.fails;
    run(reason === undefined ? id : `${id} (expected to fail: ${reason})`, () => {
      const text = sent(input);
      const words = text.replace(/\[\[[A-Z_]+_\d+\]\]/gu, ' ');
      expect(mustHide.filter((word) => anyCase(word).test(words))).toEqual([]);
      expect(mustKeep.filter((kept) => !text.includes(kept))).toEqual([]);
    });
  }
});
