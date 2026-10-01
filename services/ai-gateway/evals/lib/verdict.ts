/**
 * Verdict language: wording that states or recommends a compliance determination, an
 * administrative action or a referral (CONTEXT.md). AI output describes and points at things to
 * check; a named officer decides (ADR-007, Agenda Track 6). Accusatory tone ("concealed",
 * "suspicious") is a quality concern, not this check.
 *
 * The Swahili list is a draft for a Swahili speaker to review.
 */
/**
 * A determination stated with "comply" or "compliant", which a check instruction also names:
 * "check whether the declarant complied with the deadline" asks, "the declarant complied with the
 * deadline" and "the declarant does not comply" decide.
 */
const DETERMINATION: readonly RegExp[] = [
  /\b(?:(?:is|was|are|were|been)|(?:appears?|seems?)(?: to be)?) (?:fully )?compliant\b/,
  /\b(?:(?:has|have|had) )?(?:fully )?complied with\b/,
  /\bnot (?:fully |in )?complian(?:t|ce)\b/,
  /\b(?:does not|do not|doesn't|don't|did not|didn't|had not|hadn't|has not|hasn't|have not|haven't|never|fails? to|failed to) (?:fully )?compl(?:y|ies|ied)\b/,
];

const TERMS: readonly RegExp[] = [
  // Compliance determination.
  /\bnon[- ]?compliant\b/,
  ...DETERMINATION,
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

/** A denial: "not", "without", "rather than", "nothing", "si", "hakuna". */
const NEGATION = String.raw`(?:not|no|nothing|never|without|isn't|aren't|wasn't|doesn't|nor|rather than|instead of|si|sio|siyo|hakuna|bila)`;

/** A hedge a denial may carry: "not by itself", "not necessarily". */
const HEDGE = String.raw`(?:(?:by itself|on its own|alone|necessarily|in itself)\s+)?`;

/** A noun a denial may put before the term: "not a finding of", "not evidence that". */
const DENIED_NOUNS = String.raw`(?:finding|determination|sign|indication|indicator|evidence|proof|suggestion|allegation|conclusion|accusation|judg(?:e)?ment|assessment|case|ishara|dalili|ushahidi|uthibitisho)`;

/** What a denial may put between itself and the term: "not a finding of any", "si ishara ya". */
const DENIED_NOUN = String.raw`(?:(?:a|an|the|any)\s+)?(?:${DENIED_NOUNS}\s+(?:of|ya|za|wa)\s+(?:(?:any|the)\s+)?)?`;

/** How a denial may present the term: "should not be read as a finding of". */
const READ_AS = String.raw`(?:(?:read|taken|seen|treated|interpreted|understood|regarded|considered)\s+as\s+)?`;

/**
 * A word a denied inference may reach over to its term: a subject ("the declarant", "any"), not a
 * coordinator, a verb or an exception ("other than"), which start a predicate of their own or
 * state what the denial leaves standing.
 */
const INFERRED_WORD = String.raw`(?!(?:and|but|or|nor|yet|so|then|while|because|which|who|other|than|except|beyond|besides|na|lakini|bali|ila|is|was|are|were|be|been|being|has|have|had|do|does|did|will|would|shall|should|may|might|must|can|could)\b)[\p{L}']+`;

/**
 * A denied inference whose verb takes a clause, so a subject may follow it without "that": "does
 * not mean", "not by itself suggest", "do not conclude", "nothing in the flag itself suggests",
 * "haimaanishi".
 */
const DENIED_INFERENCE = String.raw`(?:${NEGATION}\s+${HEDGE}(?:mean|imply|suggest|conclude|assume|infer)|(?:nothing|no part of)(?:\s+${INFERRED_WORD}){0,4}\s+(?:means|implies|suggests)|haimaanishi)`;

/**
 * A denied inference whose verb takes an object, which reaches a subject only over "that": "does
 * not show", "does not constitute", "not necessarily point to", "no part of this flag indicates".
 * Its object is not denied unless it is a denied noun without "the": "does not show the source of
 * the illicit income" states the term, "did not show the proof of the illicit income" presupposes
 * it, "does not constitute a finding of wrongdoing" denies it.
 */
const DENIED_FINDING = String.raw`(?:${NEGATION}\s+${HEDGE}(?:indicate|show|prove|establish|constitute|amount to|point to)|(?:nothing|no part of)(?:\s+${INFERRED_WORD}){0,4}\s+(?:indicates|shows|proves|establishes|constitutes|amounts to|points to))`;

/** A subject and a copula a denial reaches over to the term: "the declarant is", "there was any". */
const SUBJECT = String.raw`(?:\s+${INFERRED_WORD}){0,4}(?:\s+(?:is|was|are|were|be|(?:has|have|had) been)(?:\s+(?:a|an|any))?)?\s+$`;

/** Where an inference is drawn from, before "that": "do not conclude from this flag alone that". */
const SOURCE = String.raw`(?:\s+from(?:\s+${INFERRED_WORD}){1,3})?`;

/**
 * The end of a term's clause when a negation governs the term: right before it ("not corrupt",
 * "should not be sanctioned"), through a denied noun ("not a finding of any wrongdoing", "should
 * not be read as a finding of wrongdoing"), as a denied inference over a subject and a copula
 * ("does not mean the declarant is non-compliant", "does not mean there was any wrongdoing",
 * "nothing in the flag itself suggests wrongdoing", "haimaanishi kuna rushwa", "do not conclude
 * from this flag alone that the declarant is non-compliant"), as the object of a denied finding,
 * directly or over a denied noun ("does not constitute a breach of", "does not indicate any
 * wrongdoing", "does not constitute a finding of wrongdoing"), or as a denied finding or a denied
 * noun with "that" over a subject and a copula ("does not show that the declarant is corrupt",
 * "not evidence that the declarant is dishonest"). A term joined by "or", "nor" or
 * "and" to a denied one is denied too ("not dishonest or corrupt"). A negation elsewhere in the
 * clause does not count: "did not disclose the illicit income", "there is no doubt the declarant
 * is corrupt", "does not show the source of the illicit income", "does not mean anything other
 * than fraud" and "did not show the loan and is non-compliant" state the term.
 */
const GOVERNED = [
  new RegExp(
    String.raw`(?:^|[^\p{L}'])${NEGATION}\s+${HEDGE}(?:(?:be|being|been)\s+)?${READ_AS}${DENIED_NOUN}$`,
    'u',
  ),
  new RegExp(
    String.raw`(?:^|[^\p{L}'])(?:${DENIED_INFERENCE}(?:${SOURCE}\s+that)?${SUBJECT}|${DENIED_FINDING}(?:${SOURCE}\s+that${SUBJECT}|(?:\s+(?:a|an|any))?\s+$|(?:\s+(?:a|an|any))?\s+${DENIED_NOUNS}\s+(?:of|ya|za|wa)\s+(?:(?:any|the)\s+)?$))`,
    'u',
  ),
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
      checkable: DETERMINATION.includes(term),
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
    else if (!(match.checkable && CHECK.test(clause))) found.push(match.term);
  }
  return found;
}
