/**
 * Verdict language: wording that states or recommends a compliance determination, an
 * administrative action or a referral (CONTEXT.md). AI output describes and points at things to
 * check; a named officer decides (ADR-007, Agenda Track 6). Accusatory tone ("concealed",
 * "suspicious") is a quality concern, not this check.
 *
 * The Swahili list is a draft for a Swahili speaker to review.
 */
const TERMS: readonly RegExp[] = [
  // Compliance determination.
  /\bnon-?compliant\b/,
  /\bnot compliant\b/,
  /\b(?:is|was|are|were) (?:fully )?compliant\b/,
  /\b(?:did not|didn't|failed to|has not|have not|hasn't) compl(?:y|ied)\b/,
  /\bin breach of\b/,
  /\b(?:breached|violated|violation of)\b/,
  /\bfalse(?:ly)? declar(?:ation|ed)\b/,
  // Wrongdoing.
  /\bcorrupt(?:ion|ly)?\b/,
  /\billicit\b/,
  /\bunexplained wealth\b/,
  /\bfraud(?:ulent|ulently)?\b/,
  /\bguilty\b/,
  /\bdishonest(?:ly|y)?\b/,
  /\bwrongdoing\b/,
  // Administrative action and referral.
  /\bsanction(?:s|ed)?\b/,
  /\bpenal(?:ty|ties|ise|ised|ize|ized)\b/,
  /\bdisciplinary\b/,
  /\brefer(?:red)? (?:the (?:matter|declarant|officer|case) )?to (?:the )?(?:eacc|dci|dpp|police)\b/,
  /\bprosecut(?:e|ed|ion)\b/,
  /\bcriminal\b/,
  // Swahili (draft).
  /\bhaku(?:tii|zingatia) sheria\b/,
  /\bamekiuka\b/,
  /\bukiukaji\b/,
  /\brushwa\b/,
  /\bufisadi\b/,
  /\b(?:ana|kuwa na) hatia\b/,
  /\badhabu\b/,
  /\budanganyifu\b/,
  /\btamko la uongo\b/,
  /\bmali (?:ya|za) haramu\b/,
  /\bmashtaka\b/,
  /\bkinidhamu\b/,
];

/** Words that, shortly before a term, make it a denial ("not a finding of wrongdoing"). */
const NEGATIONS = new Set([
  'not',
  'no',
  'never',
  'without',
  "isn't",
  "doesn't",
  'nor',
  'si',
  'sio',
  'siyo',
  'hakuna',
  'bila',
  'haimaanishi',
]);

/** How many words before a term a negation still applies. */
const NEGATION_REACH = 5;

/** Verdict terms in `text` that are not negated, lower-cased as found. */
export function verdictTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const found: { index: number; term: string }[] = [];
  for (const term of TERMS) {
    for (const match of lower.matchAll(new RegExp(term.source, 'gu'))) {
      const before = lower.slice(0, match.index).match(/[\p{L}']+/gu) ?? [];
      const negated = before.slice(-NEGATION_REACH).some((word) => NEGATIONS.has(word));
      if (!negated) found.push({ index: match.index, term: match[0] });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((each) => each.term);
}
