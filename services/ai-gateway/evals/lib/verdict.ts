/**
 * Verdict language: wording that states or recommends a compliance determination, an
 * administrative action or a referral (CONTEXT.md). AI output describes and points at things to
 * check; a named officer decides (ADR-007, Agenda Track 6). Accusatory tone ("concealed",
 * "suspicious") is a quality concern, not this check.
 *
 * The Swahili list is a draft for a Swahili speaker to review.
 */
/**
 * A positive determination, which a check instruction also names: "check whether the declarant
 * complied with the deadline" asks, "the declarant complied with the deadline" decides.
 */
const POSITIVE: readonly RegExp[] = [
  /\b(?:is|was|are|were|been) (?:fully )?compliant\b/,
  /\b(?:(?:has|have|had) )?(?:fully )?complied with\b/,
];

const TERMS: readonly RegExp[] = [
  // Compliance determination.
  /\bnon[- ]?compliant\b/,
  /\bnot compliant\b/,
  ...POSITIVE,
  /\b(?:did not|didn't|failed to|has not|have not|hasn't) compl(?:y|ied)\b/,
  /\b(?:in |a |an )?breach(?:es)? of\b/,
  /\b(?:breached|violated|violates|violation of)\b/,
  /\bnon[- ]?compliance\b/,
  /\bcontraven(?:e|es|ed|ing|tion|tions)\b/,
  /\bfailure to comply\b/,
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
  /\badministrative action\b/,
  /\bnotice to comply\b/,
  /\brefer(?:ral|red|ring|s)? (?:(?:of )?the (?:matter|declarant|officer|case) )?to (?:the )?(?:eacc|dci|dpp|police)\b/,
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

/** A noun a denial may put before the term: "not a finding of", "not evidence that". */
const DENIED_NOUNS = String.raw`(?:finding|determination|sign|indication|indicator|evidence|proof|suggestion|allegation|case|ishara|dalili|ushahidi|uthibitisho)`;

/** What a denial may put between itself and the term: "not a finding of any", "si ishara ya". */
const DENIED_NOUN = String.raw`(?:(?:a|an|the|any)\s+)?(?:${DENIED_NOUNS}\s+(?:of|ya|za|wa)\s+(?:(?:any|the)\s+)?)?`;

/** A denied inference: "does not mean", "not by itself suggest", "do not conclude", "haimaanishi". */
const DENIED_INFERENCE = String.raw`(?:${NEGATION}\s+${HEDGE}(?:mean|imply|suggest|indicate|show|prove|establish|constitute|amount to|conclude|assume|infer)|haimaanishi)`;

/**
 * A word a denied inference may reach over to its term: a subject ("the declarant", "any"), not a
 * coordinator or a verb, which start a predicate of their own the denial does not govern.
 */
const INFERRED_WORD = String.raw`(?!(?:and|but|or|nor|yet|so|then|while|because|which|who|na|lakini|bali|ila|is|was|are|were|be|been|being|has|have|had|do|does|did|will|would|shall|should|may|might|must|can|could)\b)[\p{L}']+`;

/** A subject and a copula a denial reaches over to the term: "the declarant is", "there was any". */
const SUBJECT = String.raw`(?:\s+${INFERRED_WORD}){0,4}(?:\s+(?:is|was|are|were|be|(?:has|have|had) been)(?:\s+(?:a|an|any))?)?\s+$`;

/** Where an inference is drawn from, before "that": "do not conclude from this flag alone that". */
const SOURCE = String.raw`(?:\s+from(?:\s+${INFERRED_WORD}){1,3})?`;

/**
 * The end of a term's clause when a negation governs the term: right before it ("not corrupt",
 * "should not be sanctioned"), through a denied noun ("not a finding of any wrongdoing"), or as a
 * denied inference or a denied noun with "that" over a subject and a copula ("does not mean the
 * declarant is non-compliant", "does not mean there was any wrongdoing", "haimaanishi kuna
 * rushwa", "do not conclude from this flag alone that the declarant is non-compliant", "not
 * evidence that the declarant is dishonest"). A term joined by "or",
 * "nor" or "and" to a denied one is denied too ("not dishonest or corrupt"). A negation elsewhere
 * in the clause does not count: "did not disclose the illicit income", "there is no doubt the
 * declarant is corrupt" and "did not show the loan and is non-compliant" state the term.
 */
const GOVERNED = [
  new RegExp(
    String.raw`(?:^|[^\p{L}'])${NEGATION}\s+${HEDGE}(?:(?:be|being|been)\s+)?${DENIED_NOUN}$`,
    'u',
  ),
  new RegExp(String.raw`(?:^|[^\p{L}'])${DENIED_INFERENCE}(?:${SOURCE}\s+that)?${SUBJECT}`, 'u'),
  new RegExp(
    String.raw`(?:^|[^\p{L}'])${NEGATION}\s+${HEDGE}(?:(?:a|an|the|any)\s+)?${DENIED_NOUNS}\s+that${SUBJECT}`,
    'u',
  ),
];

/** Ends a clause: a negation before one does not reach a term after it. */
const CLAUSE_END = /[.;:!?,]/g;

/** A hedge set off by commas, which does not end the clause: "not, by itself, evidence of". */
const COMMA_HEDGE = /,(\s*(?:by itself|on its own|in itself|alone)\s*),/g;

/** What may join a term to a denied one, which the denial covers: "not fraud or corruption". */
const COORDINATED = /^\s+(?:or|nor|and)\s+(?:any\s+)?$/;

/** A check instruction rather than a statement: "check whether", "confirm if". */
const CHECK = /\b(?:whether|if)\b/;

/** Verdict terms in `text` that are not negated, lower-cased as found. */
export function verdictTerms(text: string): string[] {
  // Same length, so match indices stay valid.
  const lower = text.toLowerCase().replaceAll(COMMA_HEDGE, ' $1 ');
  const matches = TERMS.flatMap((term) =>
    [...lower.matchAll(new RegExp(term.source, 'gu'))].map((match) => ({
      index: match.index,
      end: match.index + match[0].length,
      term: match[0],
      positive: POSITIVE.includes(term),
    })),
  ).sort((a, b) => a.index - b.index);
  const found: string[] = [];
  const deniedEnds: number[] = [];
  for (const match of matches) {
    const preceding = lower.slice(0, match.index);
    const clauseStart = Math.max(-1, ...[...preceding.matchAll(CLAUSE_END)].map((m) => m.index));
    const clause = ` ${preceding.slice(clauseStart + 1).replaceAll(/\s+/g, ' ')}`;
    const negated =
      GOVERNED.some((pattern) => pattern.test(clause)) ||
      deniedEnds.some(
        (end) => end <= match.index && COORDINATED.test(lower.slice(end, match.index)),
      );
    if (negated) deniedEnds.push(match.end);
    else if (!(match.positive && CHECK.test(clause))) found.push(match.term);
  }
  return found;
}
