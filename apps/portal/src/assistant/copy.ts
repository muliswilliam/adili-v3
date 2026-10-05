import type { ChatMessageMessages, CitationMessages, FeedbackMessages } from '@adili/ui';

import type { Language } from '../language';

/**
 * Ask Adili's words in English and Kiswahili (spec 11 FE-2, i18n): the panel is the portal's
 * first Swahili screen, so every key it shows has both. The panel's language switch picks the
 * set; answers come back in the conversation's language.
 */
export interface AskCopy {
  title: string;
  open: string;
  close: string;
  label: string;
  labelDetails: string;
  language: string;
  languageChanged: string;
  kept: string;
  keptOutside: string;
  idle: string;
  suggested: string;
  /** Over the section's suggestions under a conversation: "Suggested for Assets". */
  suggestedOn: (section: string) => string;
  on: string;
  placeholder: string;
  /** The question box outside a draft (the dashboard), where there is no section. */
  placeholderOutside: string;
  /** A decline when the Commission has no reporting officer on record. */
  declinedNoContact: string;
  rateLimitedFor: (seconds: number) => string;
  send: string;
  privacy: string;
  conversation: string;
  loading: string;
  unavailable: string;
  askAgain: string;
  search: string;
  forSection: string;
  results: (count: number) => string;
  noHits: string;
  searchFailed: string;
  missing: (count: number) => string;
  fix: string;
  more: (count: number) => string;
  /** Called with the place to open: "Open Assets → value". */
  openPlace: (place: string) => string;
  sectionNames: {
    bio: string;
    household: string;
    other: string;
    statement: string;
    income: string;
    assets: string;
    liabilities: string;
    summary: string;
    overview: string;
    home: string;
  };
  /** "Mary's assets", from the person's first name and the category's name. */
  personCategory: (name: string, category: string) => string;
  personStatement: (name: string) => string;
  message: Omit<ChatMessageMessages, keyof CitationMessages> & CitationMessages;
  feedback: Partial<FeedbackMessages>;
}

export const ASK_COPY: Record<Language, AskCopy> = {
  en: {
    title: 'Ask Adili',
    open: 'Ask Adili',
    close: 'Close',
    label: 'AI-assisted · not legal advice',
    labelDetails:
      'Answers are written by AI from the Act, the Regulations and help articles, and cite them. They are not legal advice.',
    language: 'Language',
    languageChanged: 'Language: English',
    kept: 'Kept with this draft and deleted with it.',
    keptOutside: 'Kept for 30 days after your last question, then deleted.',
    idle: 'Ask in your own words, in English or Kiswahili.',
    suggested: 'Suggested questions',
    suggestedOn: (section) => `Suggested for ${section}`,
    on: 'On',
    placeholder: 'Ask about this section…',
    placeholderOutside: 'Ask about your declaration…',
    declinedNoContact:
      'I could not find this in the Act or Regulations. Ask your reporting officer.',
    rateLimitedFor: (seconds) =>
      `You have asked many questions in a short time. Try again in ${String(seconds)} seconds.`,
    send: 'Send',
    privacy:
      'Adili does not read your amounts, names or ID numbers. It knows which section you are on and what is still missing.',
    conversation: 'Conversation',
    loading: 'Opening your conversation…',
    unavailable: 'Answers are unavailable right now. Search the help instead.',
    askAgain: 'Ask Adili again',
    search: 'Search the help',
    forSection: 'For this section',
    results: (count) => (count === 1 ? '1 result' : `${String(count)} results`),
    noHits: 'No help matches that. Try other words.',
    searchFailed: 'Help search is unavailable right now. Try again in a few minutes.',
    missing: (count) => `Still missing (${String(count)})`,
    fix: 'Fix',
    more: (count) => `and ${String(count)} more`,
    openPlace: (place) => `Open ${place}`,
    sectionNames: {
      bio: 'Your details',
      household: 'Spouses and children',
      other: 'Other information',
      statement: 'Your financial statement',
      income: 'Income',
      assets: 'Assets',
      liabilities: 'Liabilities',
      summary: 'Summary',
      overview: 'Overview',
      home: 'Home',
    },
    personCategory: (name, category) => `${name}'s ${category.toLowerCase()}`,
    personStatement: (name) => `${name}'s statement`,
    message: {
      userName: 'You',
      assistantName: 'Adili',
      answering: 'Adili is answering…',
      declined: 'I could not find this in the Act or Regulations. Ask your reporting officer:',
      stopped: 'The answer stopped before it finished.',
      retry: 'Try again',
      rateLimited: 'You have asked many questions in a short time. Try again in a minute.',
      listLabel: 'Sources',
      sourceNames: {
        act: 'Conflict of Interest Act, 2025',
        regs: 'Conflict of Interest Regulations, 2026',
        am: 'Administrative Mechanisms',
        help: 'Adili help',
      },
      readPassage: 'Read in help',
    },
    feedback: { group: 'Rate this answer', noteLabel: 'Note', sent: 'Thanks for your feedback.' },
  },
  sw: {
    title: 'Uliza Adili',
    open: 'Uliza Adili',
    close: 'Funga',
    label: 'Kwa usaidizi wa AI · si ushauri wa kisheria',
    labelDetails:
      'Majibu huandikwa na AI kutoka kwa Sheria, Kanuni na makala ya msaada, na huyataja. Si ushauri wa kisheria.',
    language: 'Lugha',
    languageChanged: 'Lugha: Kiswahili',
    kept: 'Huhifadhiwa pamoja na rasimu hii na hufutwa pamoja nayo.',
    keptOutside: 'Huhifadhiwa kwa siku 30 baada ya swali lako la mwisho, kisha hufutwa.',
    idle: 'Uliza kwa maneno yako, kwa Kiingereza au Kiswahili.',
    suggested: 'Maswali yanayopendekezwa',
    suggestedOn: (section) => `Yanayopendekezwa kwa ${section}`,
    on: 'Sehemu',
    placeholder: 'Uliza kuhusu sehemu hii…',
    placeholderOutside: 'Uliza kuhusu tamko lako…',
    declinedNoContact:
      'Sikupata jambo hili katika Sheria wala Kanuni. Muulize afisa wako wa kuripoti.',
    rateLimitedFor: (seconds) =>
      `Umeuliza maswali mengi kwa muda mfupi. Jaribu tena baada ya sekunde ${String(seconds)}.`,
    send: 'Tuma',
    privacy:
      'Adili haisomi kiasi, majina wala nambari zako za kitambulisho. Inajua uko sehemu gani na kinachokosekana.',
    conversation: 'Mazungumzo',
    loading: 'Inafungua mazungumzo yako…',
    unavailable: 'Majibu hayapatikani kwa sasa. Tafuta katika msaada badala yake.',
    askAgain: 'Uliza Adili tena',
    search: 'Tafuta katika msaada',
    forSection: 'Kwa sehemu hii',
    results: (count) => (count === 1 ? 'Tokeo 1' : `Matokeo ${String(count)}`),
    noHits: 'Hakuna msaada unaolingana. Jaribu maneno mengine.',
    searchFailed: 'Utafutaji wa msaada haupatikani kwa sasa. Jaribu tena baada ya dakika chache.',
    missing: (count) => `Bado kinakosekana (${String(count)})`,
    fix: 'Rekebisha',
    more: (count) => `na ${String(count)} zaidi`,
    openPlace: (place) => `Fungua ${place}`,
    sectionNames: {
      bio: 'Maelezo yako',
      household: 'Wenzi na watoto',
      other: 'Maelezo mengine',
      statement: 'Taarifa yako ya kifedha',
      income: 'Mapato',
      assets: 'Mali',
      liabilities: 'Madeni',
      summary: 'Muhtasari',
      overview: 'Muhtasari wa tamko',
      home: 'Nyumbani',
    },
    personCategory: (name, category) => `${category} ya ${name}`,
    personStatement: (name) => `Taarifa ya ${name}`,
    message: {
      userName: 'Wewe',
      assistantName: 'Adili',
      answering: 'Adili inajibu…',
      declined: 'Sikupata jambo hili katika Sheria wala Kanuni. Muulize afisa wako wa kuripoti:',
      stopped: 'Jibu limekatika kabla ya kukamilika.',
      retry: 'Jaribu tena',
      rateLimited: 'Umeuliza maswali mengi kwa muda mfupi. Jaribu tena baada ya dakika moja.',
      listLabel: 'Vyanzo',
      sourceNames: {
        act: 'Sheria ya Mgongano wa Maslahi, 2025',
        regs: 'Kanuni za Mgongano wa Maslahi, 2026',
        am: 'Taratibu za Utawala',
        help: 'Msaada wa Adili',
      },
      readPassage: 'Soma katika msaada',
    },
    feedback: {
      group: 'Kadiria jibu hili',
      helpful: 'Imesaidia',
      notHelpful: 'Haijasaidia',
      formLabel: 'Kwa nini halikusaidia?',
      reasonLabel: 'Kulikuwa na tatizo gani?',
      reasonPlaceholder: 'Chagua sababu',
      reasonRequired: 'Chagua sababu.',
      reasons: {
        inaccurate: 'Si sahihi',
        'missed-something': 'Imekosa kitu',
        unclear: 'Haieleweki',
        'too-long': 'Ndefu mno',
        other: 'Nyingine',
      },
      noteLabel: 'Maelezo',
      noteHint: 'Si lazima',
      notePlaceholder: 'Lilipaswa kusema nini?',
      cancel: 'Ghairi',
      send: 'Tuma ukadiriaji',
      sent: 'Asante kwa maoni yako.',
      failed: 'Ukadiriaji haukutumwa. Jaribu tena.',
    },
  },
};
