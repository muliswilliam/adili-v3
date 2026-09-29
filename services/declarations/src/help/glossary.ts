/**
 * Query expansion for help search. The statutory corpus has no official Swahili text, and the law
 * is not machine-translated (spec 11 decision), so a Swahili question is matched against the
 * English text through this glossary: each Swahili term (or phrase) found in the question adds
 * the English words the Act and Regulations use for it. It is data, reviewed by hand; keep entries
 * to words a declarant is likely to use about the declaration, and keep the English side in the
 * law's own vocabulary ("spouse", not "wife").
 *
 * A few English and Kenyan-English words are expanded the same way, where the law uses a word the
 * declarant would not ("co-own" is "joint" in the First Schedule, note 13).
 */

/** Swahili term or phrase (lowercase, words separated by one space) -> English search words. */
export const SWAHILI_GLOSSARY: Readonly<Record<string, string>> = {
  // Declaration and filing.
  tamko: 'declaration',
  taarifa: 'declaration statement',
  kutangaza: 'declare',
  tangaza: 'declare',
  fomu: 'form',
  tarehe: 'date',
  'tarehe ya mwisho': 'due date',
  'tarehe ya taarifa': 'statement date',
  mabadiliko: 'change',
  'mabadiliko makubwa': 'material change',
  tume: 'commission',
  afisa: 'officer',
  ofisa: 'officer',
  'afisa wa umma': 'public officer',
  ufafanuzi: 'clarification',
  adhabu: 'offence penalty',
  kosa: 'offence',
  uongo: 'false information',
  siri: 'confidential',
  // Household.
  familia: 'family',
  mwenzi: 'spouse',
  'mwenzi wa ndoa': 'spouse',
  mke: 'spouse',
  mume: 'spouse',
  ndoa: 'marital',
  talaka: 'marital status',
  mtoto: 'child',
  watoto: 'children',
  tegemezi: 'dependent',
  mzazi: 'parent',
  wazazi: 'parent',
  // Income.
  mapato: 'income',
  mshahara: 'salary emoluments',
  marupurupu: 'allowances emoluments',
  biashara: 'business',
  uwekezaji: 'investments',
  ajira: 'employment',
  kazi: 'employment',
  // Assets.
  mali: 'assets',
  'mali ya pamoja': 'joint assets',
  pamoja: 'joint',
  gari: 'vehicle',
  magari: 'vehicles',
  matatu: 'vehicle',
  pikipiki: 'vehicle',
  ardhi: 'land',
  shamba: 'land',
  mashamba: 'land',
  nyumba: 'building',
  jengo: 'building',
  majengo: 'buildings',
  hisa: 'shares shareholding securities',
  akaunti: 'account',
  benki: 'bank account',
  'nje ya nchi': 'outside kenya',
  // Liabilities.
  madeni: 'liabilities',
  deni: 'liability',
  mkopo: 'loan liability',
  mikopo: 'loan liabilities',
  // Interests and conduct.
  zawadi: 'gift',
  kampuni: 'company',
  mkurugenzi: 'directorship',
  ukurugenzi: 'directorship',
  uanachama: 'membership',
  maslahi: 'interest',
  'mgongano wa maslahi': 'conflict of interest',
};

/** English and Kenyan-English words the law says differently. */
export const ENGLISH_SYNONYMS: Readonly<Record<string, string>> = {
  wife: 'spouse',
  husband: 'spouse',
  salary: 'emoluments',
  car: 'vehicle',
  matatu: 'vehicle',
  'co-own': 'joint',
  'co-owned': 'joint',
  'co-owner': 'joint',
  jointly: 'joint',
  deadline: 'due date',
};

/** The longest glossary phrase, in words. */
const LONGEST = Math.max(
  ...Object.keys({ ...SWAHILI_GLOSSARY, ...ENGLISH_SYNONYMS }).map(
    (term) => term.split(' ').length,
  ),
);

/** The words of a question, lowercased (hyphenated words kept whole). */
export function words(question: string): string[] {
  return (
    question
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
  );
}

/**
 * The English words the glossary adds for a question: every term or phrase of `glossary` that
 * occurs in it, longest match first, each word of the question used once.
 */
export function expand(question: string, glossary: Readonly<Record<string, string>>): string[] {
  const tokens = words(question);
  const added: string[] = [];
  for (let at = 0; at < tokens.length;) {
    let matched = 0;
    for (let size = Math.min(LONGEST, tokens.length - at); size > 0 && !matched; size -= 1) {
      const term = tokens.slice(at, at + size).join(' ');
      const english = Object.hasOwn(glossary, term) ? glossary[term] : undefined;
      if (english !== undefined) {
        added.push(english);
        matched = size;
      }
    }
    at += matched || 1;
  }
  return added;
}

/**
 * Swahili function words left out of the `simple` search, which has no Swahili stop list: without
 * this, "ya" or "na" would match every Swahili article.
 */
export const SWAHILI_STOPWORDS: readonly string[] = [
  'je',
  'ni',
  'si',
  'na',
  'ya',
  'wa',
  'la',
  'za',
  'cha',
  'vya',
  'kwa',
  'kwenye',
  'katika',
  'kuhusu',
  'kama',
  'au',
  'pia',
  'tu',
  'ili',
  'hadi',
  'hii',
  'hiyo',
  'huu',
  'huo',
  'ile',
  'yangu',
  'wangu',
  'changu',
  'langu',
  'zangu',
  'yake',
  'wake',
  'nini',
  'gani',
  'nani',
  'lini',
  'vipi',
  'mimi',
  'yeye',
  'sisi',
  'wao',
  'nina',
  'sina',
  'kuna',
  'lazima',
];
