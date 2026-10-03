import type { Language } from '../language';

/**
 * The topics the help pages browse by (spec 11 FE-3). The corpus has no topic field: a passage
 * says what it covers in its tags (section kinds, item types, topics), and help search weighs
 * tags above the text. So a topic is browsed as a search for its tag words, in each language
 * (a Kiswahili search reaches the English law through the service's glossary), and an article
 * belongs to the first topic one of its tags names.
 */

export const TOPIC_KEYS = [
  'start',
  'people',
  'income',
  'assets',
  'liabilities',
  'changes',
  'submit',
  'law',
] as const;

export type TopicKey = (typeof TOPIC_KEYS)[number];

export interface HelpTopic {
  key: TopicKey;
  /** What the topic's search asks, per language. */
  query: Record<Language, string>;
  /** The corpus tags that put an article in the topic. */
  tags: readonly string[];
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    key: 'start',
    query: {
      en: 'declaration due-date initial biennial final responsible-commission',
      sw: 'tamko tarehe ya mwisho fomu tume',
    },
    tags: [
      'declaration',
      'due-date',
      'initial',
      'biennial',
      'final',
      'responsible-commission',
      'employment',
      'bio',
    ],
  },
  {
    key: 'people',
    query: { en: 'spouse dependent-child household', sw: 'mwenzi watoto tegemezi familia' },
    tags: ['spouse', 'dependent-child', 'household'],
  },
  {
    key: 'income',
    query: {
      en: 'income salary emoluments allowances business rent',
      sw: 'mapato mshahara marupurupu biashara',
    },
    tags: [
      'income',
      'income-period',
      'salary-emoluments',
      'allowances',
      'business',
      'rent',
      'dividends-interest',
      'pension',
      'farming',
      'consultancy',
    ],
  },
  {
    key: 'assets',
    query: {
      en: 'assets land vehicle building joint bank-account',
      sw: 'mali ardhi gari nyumba pamoja hisa',
    },
    tags: [
      'assets',
      'joint',
      'land',
      'building',
      'vehicle',
      'securities',
      'shareholding',
      'bank-account',
      'cash',
      'receivable',
    ],
  },
  {
    key: 'liabilities',
    query: { en: 'liabilities loan mortgage guarantee', sw: 'madeni deni mkopo mikopo' },
    tags: ['liabilities', 'loan', 'mortgage', 'guarantee'],
  },
  {
    key: 'changes',
    query: { en: 'material-change', sw: 'mabadiliko makubwa' },
    tags: ['material-change'],
  },
  {
    key: 'submit',
    query: {
      en: 'filing submit acknowledgement amend clarification',
      sw: 'kuwasilisha risiti ufafanuzi',
    },
    tags: ['filing', 'clarification'],
  },
  {
    key: 'law',
    query: {
      en: 'definition offence confidentiality conflict-of-interest',
      sw: 'adhabu kosa siri mgongano wa maslahi',
    },
    tags: ['definition', 'offence', 'confidentiality', 'conflict-of-interest', 'gifts'],
  },
];

export function topicQuery(key: TopicKey, language: Language): string {
  return HELP_TOPICS.find((topic) => topic.key === key)?.query[language] ?? '';
}

/**
 * The topic an article sits under, for its breadcrumb: the most specific first (a passage on
 * spouses' income is about spouses), "The law" when no tag names a topic.
 */
const SPECIFIC_FIRST: readonly TopicKey[] = [
  'changes',
  'people',
  'liabilities',
  'assets',
  'income',
  'submit',
  'start',
  'law',
];

export function topicOf(tags: readonly string[]): TopicKey {
  return (
    SPECIFIC_FIRST.find((key) =>
      HELP_TOPICS.find((topic) => topic.key === key)?.tags.some((tag) => tags.includes(tag)),
    ) ?? 'law'
  );
}
