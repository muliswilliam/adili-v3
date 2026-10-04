/**
 * A small slice of the legal corpus and help articles for the assistant mock, in English and
 * Kiswahili where the article has both (the Act and Regulations are quoted in English with a
 * Kiswahili rendering for the demo). Tags are section kinds and statement categories, so help
 * search can boost the section the declarant is on.
 */

export type CorpusSource = 'act' | 'regs' | 'am' | 'help';

export interface CorpusPassage {
  id: string;
  source: CorpusSource;
  citation: string;
  tags: readonly string[];
  title: readonly [en: string, sw: string | null];
  text: readonly [en: string, sw: string | null];
}

export const CORPUS: readonly CorpusPassage[] = [
  {
    id: 'act-31-1',
    source: 'act',
    citation: 'Act s.31(1)',
    tags: ['household', 'statement', 'income', 'assets', 'liabilities'],
    title: ['Who you declare for', 'Unatangaza kwa ajili ya nani'],
    text: [
      'Every public officer shall submit to their responsible Commission a declaration of his or her income, assets and liabilities and the income, assets and liabilities of his or her spouse and dependent children under the age of eighteen years.',
      'Kila afisa wa umma atawasilisha kwa Tume inayohusika tamko la mapato, mali na madeni yake, pamoja na mapato, mali na madeni ya mwenzi wake na watoto wanaomtegemea walio chini ya umri wa miaka kumi na minane.',
    ],
  },
  {
    id: 'act-31-4',
    source: 'act',
    citation: 'Act s.31(4)',
    tags: ['other', 'income', 'assets', 'liabilities'],
    title: ['Material change', 'Mabadiliko makubwa'],
    text: [
      '"Material change" means: (a) at least twenty-five percent increase or decrease in the value of an income, asset or liability; (b) the disposal or acquisition of an asset or liability; (c) changes in marital status; (d) appointment to or changes in directorships; (e) changes in membership in companies or partnerships and other legal entities; or (f) changes in membership in social associations, societies, clubs, foundations or trusts.',
      '"Mabadiliko makubwa" ni: (a) ongezeko au upungufu wa angalau asilimia ishirini na tano katika thamani ya mapato, mali au deni; (b) kuuza au kupata mali au deni; (c) mabadiliko ya hali ya ndoa; (d) uteuzi au mabadiliko katika ukurugenzi; (e) mabadiliko ya uanachama katika kampuni, ubia na vyombo vingine vya kisheria; au (f) mabadiliko ya uanachama katika vyama, jumuiya, vilabu, wakfu au amana.',
    ],
  },
  {
    id: 'act-34',
    source: 'act',
    citation: 'Act s.34',
    tags: ['summary'],
    title: ['When to declare', 'Wakati wa kutangaza'],
    text: [
      '(1) A public officer shall, within thirty days of appointment, submit an initial declaration for the period of one year prior to appointment. (2) Every public officer shall, once every two years, submit a declaration as at the first day of November of the declaration year, within the month of December next following. (3) A public officer shall, within thirty days after ceasing to be a public officer, submit a final declaration.',
      '(1) Afisa wa umma atawasilisha tamko la kwanza ndani ya siku thelathini baada ya uteuzi, kwa kipindi cha mwaka mmoja kabla ya uteuzi. (2) Kila afisa wa umma atawasilisha tamko kila baada ya miaka miwili, kufikia tarehe moja Novemba ya mwaka wa tamko, ndani ya mwezi wa Desemba unaofuata. (3) Afisa wa umma atawasilisha tamko la mwisho ndani ya siku thelathini baada ya kuacha kuwa afisa wa umma.',
    ],
  },
  {
    id: 'fs-5',
    source: 'act',
    citation: 'First Schedule, para 5',
    tags: ['bio'],
    title: ['Employment information', 'Maelezo ya ajira'],
    text: [
      'Employment information: (a) designation; (b) name of employer; (c) nature of employment (permanent, temporary, contract, etc.).',
      'Maelezo ya ajira: (a) cheo; (b) jina la mwajiri; (c) aina ya ajira (ya kudumu, ya muda, ya mkataba, n.k.).',
    ],
  },
  {
    id: 'fs-8',
    source: 'act',
    citation: 'First Schedule, para 8',
    tags: ['statement', 'income', 'assets', 'liabilities'],
    title: ['The financial statement', 'Taarifa ya kifedha'],
    text: [
      'A separate statement is required for the officer and each spouse and dependent child under the age of 18 years. Assets include land, buildings, vehicles, investments and financial obligations owed to the person, with their location and approximate value as of the statement date.',
      'Taarifa tofauti inahitajika kwa afisa na kila mwenzi na mtoto anayemtegemea aliye chini ya miaka 18. Mali ni pamoja na ardhi, majengo, magari, uwekezaji na madeni unayodai, pamoja na mahali ilipo na thamani ya kukadiria kufikia tarehe ya taarifa.',
    ],
  },
  {
    id: 'regs-21',
    source: 'regs',
    citation: 'Regs r.21',
    tags: ['other'],
    title: ['Declaring a material change', 'Kutangaza mabadiliko makubwa'],
    text: [
      'A material change shall, for purposes of section 31(4) of the Act, be specified by the declarant in paragraph 9 of the declaration form set out in the First Schedule to the Act.',
      'Mabadiliko makubwa, kwa madhumuni ya kifungu 31(4) cha Sheria, yataelezwa na mtangazaji katika aya ya 9 ya fomu ya tamko iliyo katika Jedwali la Kwanza la Sheria.',
    ],
  },
  {
    id: 'am-24',
    source: 'am',
    citation: 'AM 24',
    tags: ['statement', 'assets'],
    title: ['Approximate values', 'Thamani za kukadiria'],
    text: [
      'Declare approximate values as at the statement date. A reasonable estimate of what the asset would sell for is enough; a professional valuation is not required. Declare jointly held assets at their whole value and state your share.',
      'Tangaza thamani za kukadiria kufikia tarehe ya taarifa. Makadirio ya busara ya bei ambayo mali ingeuzwa yanatosha; tathmini ya kitaalamu haihitajiki. Tangaza mali inayomilikiwa kwa pamoja kwa thamani yake yote na ueleze sehemu yako.',
    ],
  },
  {
    id: 'help-joint',
    source: 'help',
    citation: 'Help: Joint assets',
    tags: ['statement', 'assets'],
    title: ['Joint assets', 'Mali ya pamoja'],
    text: [
      'If you own an asset with someone else, declare it once in your statement at its whole value. Switch on "Jointly held" and enter your share, for example 50%.',
      'Ukimiliki mali pamoja na mtu mwingine, itangaze mara moja katika taarifa yako kwa thamani yake yote. Washa "Inamilikiwa kwa pamoja" na uandike sehemu yako, kwa mfano 50%.',
    ],
  },
  {
    id: 'help-value',
    source: 'help',
    citation: 'Help: Valuing assets',
    tags: ['statement', 'assets'],
    title: ['Valuing assets', 'Kuthamini mali'],
    text: [
      'Use what the asset would sell for on the statement date. For a car, compare prices of similar cars; for land, recent sales nearby. A rough figure is fine.',
      'Tumia bei ambayo mali ingeuzwa tarehe ya taarifa. Kwa gari, linganisha bei za magari yanayofanana; kwa ardhi, mauzo ya karibuni jirani. Kiasi cha kukadiria kinatosha.',
    ],
  },
  {
    id: 'help-children',
    source: 'help',
    citation: 'Help: Dependent children',
    tags: ['household'],
    title: ['Dependent children', 'Watoto wanaokutegemea'],
    text: [
      'Include children who are under 18 on the statement date. A child who turned 18 before that date is not included and needs no statement.',
      'Jumuisha watoto walio chini ya miaka 18 tarehe ya taarifa. Mtoto aliyetimiza miaka 18 kabla ya tarehe hiyo hajumuishwi na hahitaji taarifa.',
    ],
  },
  {
    id: 'help-spouse',
    source: 'help',
    citation: "Help: Your spouse's income",
    tags: ['household', 'statement', 'income'],
    title: ["Your spouse's income", 'Mapato ya mwenzi wako'],
    text: [
      "Declare your spouse's salary and other income in their own financial statement, as an approximate amount for the income period.",
      'Tangaza mshahara na mapato mengine ya mwenzi wako katika taarifa yake ya kifedha, kwa kiasi cha kukadiria kwa kipindi cha mapato.',
    ],
  },
  {
    id: 'help-loans',
    source: 'help',
    citation: 'Help: Loans',
    tags: ['statement', 'liabilities'],
    title: ['Loans and other debts', 'Mikopo na madeni mengine'],
    text: [
      'Declare what was owed on the statement date: the balance on your loan statement, not the amount you first borrowed. Include SACCO loans, mortgages, hire purchase and money owed to people.',
      'Tangaza kiasi kilichodaiwa tarehe ya taarifa: salio kwenye taarifa ya mkopo wako, si kiasi ulichokopa mwanzoni. Jumuisha mikopo ya SACCO, rehani, mikopo ya kununua kwa awamu na pesa unazodaiwa na watu.',
    ],
  },
  {
    id: 'help-amend',
    source: 'help',
    citation: 'Help: Amending',
    tags: ['summary'],
    title: ['Amending a declaration', 'Kurekebisha tamko'],
    text: [
      'After you submit, you can amend your declaration until the due date. Each amendment files a new version, and earlier versions are kept.',
      'Baada ya kuwasilisha, unaweza kurekebisha tamko lako hadi tarehe ya mwisho. Kila marekebisho yanawasilisha toleo jipya, na matoleo ya awali yanahifadhiwa.',
    ],
  },
];

export function passage(id: string): CorpusPassage {
  const found = CORPUS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No passage ${id}`);
  return found;
}
