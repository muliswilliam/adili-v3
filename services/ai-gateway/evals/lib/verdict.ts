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
  /\bnon[- ]?compliant\b/,
  /\bnot compliant\b/,
  /\b(?:is|was|are|were|been) (?:fully )?compliant\b/,
  /\b(?:(?:has|have|had) )?(?:fully )?complied with\b/,
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

/** A denial: "not", "without", "rather than", "si", "hakuna". */
const NEGATION = String.raw`(?:not|no|never|without|isn't|aren't|wasn't|doesn't|nor|rather than|instead of|si|sio|siyo|hakuna|bila)`;

/** A hedge a denial may carry: "not by itself", "not necessarily". */
const HEDGE = String.raw`(?:(?:by itself|on its own|alone|necessarily|in itself)\s+)?`;

/** What a denial may put between itself and the term: "not a finding of any", "si ishara ya". */
const DENIED_NOUN = String.raw`(?:(?:a|an|the|any)\s+)?(?:(?:finding|determination|sign|indication|indicator|evidence|proof|suggestion|allegation|case|ishara|dalili|ushahidi|uthibitisho)\s+(?:of|ya|za|wa)\s+(?:(?:any|the)\s+)?)?`;

/**
 * The end of a term's clause when a negation governs the term: right before it ("not corrupt",
 * "should not be sanctioned"), through a denied noun ("not a finding of any wrongdoing"), or as a
 * denied inference ("does not by itself suggest any wrongdoing", "haimaanishi kuna rushwa").
 * A negation elsewhere in the clause does not count: "did not disclose the illicit income" and
 * "there is no doubt the declarant is corrupt" state the term.
 */
const GOVERNED = [
  new RegExp(
    String.raw`(?:^|[^\p{L}'])${NEGATION}\s+${HEDGE}(?:(?:be|being|been)\s+)?${DENIED_NOUN}$`,
    'u',
  ),
  new RegExp(
    String.raw`(?:^|[^\p{L}'])(?:${NEGATION}\s+${HEDGE}(?:mean|imply|suggest|indicate|show|prove|establish)|haimaanishi)(?:\s+[\p{L}']+){0,4}\s+$`,
    'u',
  ),
];

/** Ends a clause: a negation before one does not reach a term after it. */
const CLAUSE_END = /[.;:!?,]/g;

/** Verdict terms in `text` that are not negated, lower-cased as found. */
export function verdictTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const found: { index: number; term: string }[] = [];
  for (const term of TERMS) {
    for (const match of lower.matchAll(new RegExp(term.source, 'gu'))) {
      const preceding = lower.slice(0, match.index);
      const clauseStart = Math.max(-1, ...[...preceding.matchAll(CLAUSE_END)].map((m) => m.index));
      const clause = ` ${preceding.slice(clauseStart + 1).replaceAll(/\s+/g, ' ')}`;
      const negated = GOVERNED.some((pattern) => pattern.test(clause));
      if (!negated) found.push({ index: match.index, term: match[0] });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((each) => each.term);
}
