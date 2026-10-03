import type { AssistantLanguage } from '../server/declarations/types';
import type { TopicKey } from './topics';

/** The help pages' words in English and Kiswahili (spec 11 FE-3, i18n). */

export type HelpLanguage = AssistantLanguage;

export interface HelpCopy {
  title: string;
  /** The page's `<title>`. */
  documentTitle: string;
  language: string;
  search: string;
  searchPlaceholder: string;
  clear: string;
  results: (count: number) => string;
  noResults: string;
  noResultsHint: string;
  allTopics: string;
  topics: Record<TopicKey, { name: string; about: string }>;
  related: string;
  englishOnly: string;
  /** On a Swahili page whose passage has only English text. */
  notYetInSwahili: string;
  inForceFrom: (date: string) => string;
  statutory: string;
  sourceNames: { act: string; regs: string; am: string; help: string };
  /** The tag on a help article: "Help", or "TSC help" for a Commission's. */
  helpTag: (issuerCode: string | null) => string;
  unavailable: string;
  notFound: string;
  notFoundHint: string;
  /** The help link in the page header. */
  open: string;
}

const EN: HelpCopy = {
  title: 'Help',
  documentTitle: 'Help · Adili Online',
  language: 'Language',
  search: 'Search the help',
  searchPlaceholder: 'Search, e.g. joint assets',
  clear: 'Clear search',
  results: (count) => (count === 1 ? '1 result' : `${String(count)} results`),
  noResults: 'No results',
  noResultsHint: 'Try other words, for example "joint".',
  allTopics: 'All topics',
  topics: {
    start: { name: 'Getting started', about: 'Who declares, and when' },
    people: { name: 'Spouses and children', about: 'Who you declare for' },
    income: { name: 'Income', about: 'Salary, business, rent and more' },
    assets: { name: 'Assets', about: 'Land, vehicles and joint assets' },
    liabilities: { name: 'Liabilities', about: 'Loans, mortgages and guarantees' },
    changes: { name: 'Material changes', about: 'What counts, and how to explain it' },
    submit: { name: 'Submitting and slips', about: 'Slips, amending, clarifications' },
    law: { name: 'The law', about: 'Definitions and offences' },
  },
  related: 'Related',
  englishOnly: 'English only',
  notYetInSwahili: 'Not yet in Kiswahili. Shown in English.',
  inForceFrom: (date) => `In force from ${date}`,
  statutory: 'Statutory text, read only',
  sourceNames: {
    act: 'Conflict of Interest Act, 2025',
    regs: 'Conflict of Interest Regulations, 2026',
    am: 'Administrative Mechanisms',
    help: 'Adili help',
  },
  helpTag: (issuerCode) => (issuerCode ? `${issuerCode} help` : 'Help'),
  unavailable: 'Help cannot be shown right now. Try again in a few minutes.',
  notFound: 'This help page is not available',
  notFoundHint: 'It may have been replaced. Search the help instead.',
  open: 'Help',
};

const SW: HelpCopy = {
  title: 'Msaada',
  documentTitle: 'Msaada · Adili Online',
  language: 'Lugha',
  search: 'Tafuta katika msaada',
  searchPlaceholder: 'Tafuta, kwa mfano mali ya pamoja',
  clear: 'Futa utafutaji',
  results: (count) => `Matokeo ${String(count)}`,
  noResults: 'Hakuna matokeo',
  noResultsHint: 'Jaribu maneno mengine, kwa mfano "mali".',
  allTopics: 'Mada zote',
  topics: {
    start: { name: 'Kuanza', about: 'Nani anatangaza, na lini' },
    people: { name: 'Wenzi na watoto', about: 'Unatangaza kwa ajili ya nani' },
    income: { name: 'Mapato', about: 'Mshahara, biashara, kodi na zaidi' },
    assets: { name: 'Mali', about: 'Ardhi, magari na mali ya pamoja' },
    liabilities: { name: 'Madeni', about: 'Mikopo, rehani na dhamana' },
    changes: { name: 'Mabadiliko makubwa', about: 'Yanayohesabiwa, na jinsi ya kueleza' },
    submit: { name: 'Kuwasilisha na risiti', about: 'Risiti, marekebisho, ufafanuzi' },
    law: { name: 'Sheria', about: 'Maana za maneno na makosa' },
  },
  related: 'Zinazohusiana',
  englishOnly: 'Kiingereza tu',
  notYetInSwahili: 'Bado haipatikani kwa Kiswahili. Inaonyeshwa kwa Kiingereza.',
  inForceFrom: (date) => `Inatumika tangu ${date}`,
  statutory: 'Maandishi ya kisheria',
  sourceNames: {
    act: 'Sheria ya Mgongano wa Maslahi, 2025',
    regs: 'Kanuni za Mgongano wa Maslahi, 2026',
    am: 'Taratibu za Kiutawala',
    help: 'Msaada wa Adili',
  },
  helpTag: (issuerCode) => (issuerCode ? `Msaada wa ${issuerCode}` : 'Msaada'),
  unavailable: 'Msaada hauwezi kuonyeshwa sasa. Jaribu tena baada ya dakika chache.',
  notFound: 'Ukurasa huu wa msaada haupatikani',
  notFoundHint: 'Huenda umebadilishwa. Tafuta katika msaada badala yake.',
  open: 'Msaada',
};

export const HELP_COPY: Record<HelpLanguage, HelpCopy> = { en: EN, sw: SW };
