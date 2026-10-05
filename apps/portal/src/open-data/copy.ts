import {
  formatNumber,
  type ReleaseStatusBadgeMessages,
  type SuppressionLegendMessagesOverride,
  type SuppressionMarkerMessagesOverride,
} from '@adili/ui';

import { inLanguage, type Language } from '../declaration/translatable';
import type {
  Cycle,
  NationalMeasure,
  OpenDataTableName,
  ReleaseKind,
  ReportStatus,
} from '../server/reporting/types';

/**
 * Words of the public Open data page and About this data (spec 09b FE-4), in English and
 * Swahili: the page is public, so both are complete (the declaration's copy tables fill Swahili
 * later). Dataset column names stay in English (the files' keys); the glossary and the column
 * table give both. Keyed by the contract's types where it has them, so a table, measure or cycle
 * the contract adds is a type error here until it has words.
 */

export type { Language };

/** The page's language as its search param: English is the default, so it is left out. */
export function langParam(language: Language): 'sw' | undefined {
  return language === 'sw' ? 'sw' : undefined;
}

/** The page's language from its search param. */
export function languageOf(lang: 'sw' | undefined): Language {
  return lang ?? 'en';
}

function both<T>(en: T, sw: T): { en: T; sw: T } {
  return { en, sw };
}

const PAGE = {
  title: both('Open data', 'Data huria'),
  metaTitle: both('Open data · Adili Online', 'Data huria · Adili Online'),
  lead: both(
    'Declaration and compliance figures for every Responsible Commission, published by EACC with each approved national report. Totals only: no names and no declarations.',
    'Takwimu za matamko na utiifu kwa kila Tume Husika, zinazochapishwa na EACC pamoja na kila ripoti ya kitaifa iliyoidhinishwa. Jumla tu: hakuna majina wala matamko.',
  ),
  nav: both('Open data navigation', 'Urambazaji wa data huria'),
  navOpenData: both('Open data', 'Data huria'),
  navAbout: both('About this data', 'Kuhusu data hii'),
  signIn: both('Sign in', 'Ingia'),
  language: both('Language', 'Lugha'),
  release: both('Release', 'Chapisho'),
  version: both('Version', 'Toleo'),
  versionOption: both(
    (version: number, withdrawn: boolean) =>
      `Version ${String(version)}${withdrawn ? ' (withdrawn)' : ''}`,
    (version: number, withdrawn: boolean) =>
      `Toleo ${String(version)}${withdrawn ? ' (limeondolewa)' : ''}`,
  ),
  publishedOn: both(
    (date: string) => `Published ${date}`,
    (date: string) => `Imechapishwa ${date}`,
  ),
  verify: both('Verify this release', 'Thibitisha chapisho hili'),
  downloads: both('Downloads', 'Vipakuliwa'),
  goToDownloads: both('Go to downloads', 'Nenda kwenye vipakuliwa'),
  headline: both('Headline figures', 'Takwimu kuu'),
  declarationRate: both('Declaration rate', 'Kiwango cha matamko'),
  declarationsMade: both('Declarations made', 'Matamko yaliyofanywa'),
  complianceRate: both('Compliance rate', 'Kiwango cha utiifu'),
  referrals: both('Referrals to EACC', 'Rufaa kwa EACC'),
  commissionsReported: both(
    (reported: string, all: string) => `${reported} of ${all} Commissions reported`,
    (reported: string, all: string) => `Tume ${reported} kati ya ${all} ziliripoti`,
  ),
  ofExpected: both(
    (expected: string) => `of ${expected} expected`,
    (expected: string) => `kati ya ${expected} yaliyotarajiwa`,
  ),
  determinations: both(
    (count: string) => `${count} determinations`,
    (count: string) => `maamuzi ${count}`,
  ),
  actions: both(
    (count: string) => `${count} administrative actions`,
    (count: string) => `hatua za kiutawala ${count}`,
  ),
  noFigure: both('Not available', 'Haipatikani'),
  byCommission: both('By Commission', 'Kwa Tume'),
  measure: both('Measure', 'Kipimo'),
  highestFirst: both('Highest first', 'Juu kwanza'),
  lowestFirst: both('Lowest first', 'Chini kwanza'),
  showTable: both('Table', 'Jedwali'),
  showChart: both('Chart', 'Chati'),
  showAll: both(
    (count: number) => `Show all ${String(count)}`,
    (count: number) => `Onyesha zote ${String(count)}`,
  ),
  showFewer: both('Show fewer', 'Onyesha chache'),
  national: both(
    (rate: string) => `National ${rate}`,
    (rate: string) => `Kitaifa ${rate}`,
  ),
  commission: both('Commission', 'Tume'),
  chartTitle: both(
    (measure: string, year: string) => `${measure} by Commission, ${year}`,
    (measure: string, year: string) => `${measure} kwa Tume, ${year}`,
  ),
  chartNote: both(
    'Commissions that have not reported, and figures not shown to protect privacy, are listed last and not drawn.',
    'Tume ambazo hazijaripoti, na takwimu zisizoonyeshwa ili kulinda faragha, zimeorodheshwa mwisho bila kuchorwa.',
  ),
  noDeterminations: both(
    'Commissions with no compliance determinations this year are left out.',
    'Tume zisizo na maamuzi ya utiifu mwaka huu zimeachwa.',
  ),
  trend: both('National trend', 'Mwenendo wa kitaifa'),
  trendTitle: both(
    'National declaration and compliance rates by financial year',
    'Viwango vya kitaifa vya matamko na utiifu kwa mwaka wa fedha',
  ),
  financialYear: both('Financial year', 'Mwaka wa fedha'),
  trendEmptyTitle: both(
    'The trend appears with a second year',
    'Mwenendo utaonekana mwaka wa pili',
  ),
  trendEmpty: both(
    'Only one annual release is published up to this year.',
    'Chapisho moja tu la mwaka limetolewa hadi mwaka huu.',
  ),
  withdrawnTitle: both(
    (date: string) => `This release was withdrawn on ${date}.`,
    (date: string) => `Chapisho hili liliondolewa tarehe ${date}.`,
  ),
  reason: both('Reason', 'Sababu'),
  viewCorrected: both(
    (version: number) => `View version ${String(version)}`,
    (version: number) => `Angalia toleo ${String(version)}`,
  ),
  noCorrectionYet: both(
    'A corrected version has not been published yet.',
    'Toleo lililosahihishwa bado halijachapishwa.',
  ),
  tables: both('Tables', 'Majedwali'),
  cycleChoice: both('Cycle', 'Mzunguko'),
  downloadCsv: both(
    (file: string) => `Download ${file}`,
    (file: string) => `Pakua ${file}`,
  ),
  sortBy: both(
    (column: string) => `Sort by ${column}`,
    (column: string) => `Panga kwa ${column}`,
  ),
  noRows: both(
    'This table has no rows in this release.',
    'Jedwali hili halina safu katika chapisho hili.',
  ),
  notCollectedNote: both(
    'Figures not collected yet are left empty, not zero.',
    'Takwimu ambazo bado hazikusanywi zimeachwa tupu, si sifuri.',
  ),
  pageOf: both(
    (page: number, pages: number) => `Page ${String(page)} of ${String(pages)}`,
    (page: number, pages: number) => `Ukurasa ${String(page)} kati ya ${String(pages)}`,
  ),
  previous: both('Previous', 'Iliyotangulia'),
  next: both('Next', 'Inayofuata'),
  csvPerTable: both('CSV per table', 'CSV kwa kila jedwali'),
  releaseJson: both('Release (JSON)', 'Chapisho (JSON)'),
  rows: both(
    (count: string) => `${count} rows`,
    (count: string) => `safu ${count}`,
  ),
  sha256: both('SHA-256 of the file', 'SHA-256 ya faili'),
  verificationCode: both('Verification code', 'Nambari ya uthibitisho'),
  verifyHint: both(
    'Checks the signed manifest that lists every file and its SHA-256 fingerprint.',
    'Hukagua orodha iliyotiwa sahihi ya faili zote na alama zake za SHA-256.',
  ),
  qrLabel: both('QR code to verify this release', 'Msimbo wa QR wa kuthibitisha chapisho hili'),
  aboutLink: both('Definitions, columns and API', 'Maana, safu na API'),
  loading: both('Loading open data', 'Inapakia data huria'),
  errorTitle: both('We could not load open data', 'Hatukuweza kupakia data huria'),
  error: both(
    'Check your connection and try again.',
    'Angalia muunganisho wako kisha ujaribu tena.',
  ),
  rateTitle: both('Too many requests', 'Maombi mengi mno'),
  rate: both(
    (seconds: number | null) =>
      seconds
        ? `Wait ${String(seconds)} seconds, then try again.`
        : 'Wait a minute, then try again.',
    (seconds: number | null) =>
      seconds
        ? `Subiri sekunde ${String(seconds)}, kisha ujaribu tena.`
        : 'Subiri dakika moja, kisha ujaribu tena.',
  ),
  retry: both('Try again', 'Jaribu tena'),
  noneTitle: both('No open data yet', 'Bado hakuna data huria'),
  none: both(
    'The first release is published when EACC approves the national report.',
    'Chapisho la kwanza hutolewa EACC inapoidhinisha ripoti ya kitaifa.',
  ),
  notFoundTitle: both('There is no such release', 'Hakuna chapisho kama hilo'),
  notFound: both(
    'It may never have been published. The latest release is one click away.',
    'Huenda halikuwahi kuchapishwa. Chapisho la karibuni liko hapa.',
  ),
  latest: both('Open the latest release', 'Fungua chapisho la karibuni'),
};

const ABOUT = {
  title: both('About this data', 'Kuhusu data hii'),
  metaTitle: both('About this data · Adili Online', 'Kuhusu data hii · Adili Online'),
  back: both('Open data', 'Data huria'),
  privacy: both('Privacy', 'Faragha'),
  privacyText: both(
    'Figures are totals only, by Commission, reporting entity type and cycle. No names and no individual declarations.',
    'Takwimu ni za jumla tu, kwa Tume, aina ya shirika na mzunguko. Hakuna jina wala tamko la mtu binafsi.',
  ),
  definitions: both('Definitions', 'Maana'),
  columns: both('Tables and columns', 'Majedwali na safu'),
  column: both('Column', 'Safu'),
  api: both('API', 'API'),
  apiOps: both(
    [
      'Published and withdrawn releases',
      'A release, its tables, their SHA-256 and the verification link',
      'A table as JSON (or CSV with Accept: text/csv)',
      'A table as CSV, to download',
    ],
    [
      'Machapisho yaliyochapishwa na yaliyoondolewa',
      'Chapisho, majedwali yake, SHA-256 zake na kiungo cha uthibitisho',
      'Jedwali kama JSON (au CSV kwa Accept: text/csv)',
      'Jedwali kama CSV, la kupakua',
    ],
  ),
  apiNote: both(
    'No sign-in and any website may call it. Responses are cached for an hour and carry an ETag. Too many requests get a 429 with Retry-After.',
    'Hakuna kuingia na tovuti yoyote inaweza kuiita. Majibu huhifadhiwa kwa saa moja na yana ETag. Maombi mengi mno hupata 429 pamoja na Retry-After.',
  ),
  csvNote: both(
    'In CSV, a figure that is not shown is an empty cell and the row’s _suppressed column is true. Rates are fractions (0.832 is 83.2%).',
    'Kwenye CSV, takwimu isiyoonyeshwa ni kisanduku tupu na safu ya _suppressed ya mstari huo ni true. Viwango ni sehemu (0.832 ni 83.2%).',
  ),
};

export type PageCopy = ReturnType<typeof pageCopy>;
export const pageCopy = (language: Language) => inLanguage(PAGE, language);
export const aboutCopy = (language: Language) => inLanguage(ABOUT, language);

const TABLE_NAMES: Record<OpenDataTableName, { en: string; sw: string }> = {
  'filing-by-commission': both('Declarations by Commission', 'Matamko kwa Tume'),
  'compliance-by-commission': both('Compliance by Commission', 'Utiifu kwa Tume'),
  'by-entity-type': both('By reporting entity type', 'Kwa aina ya shirika la kuripoti'),
  'by-cycle': both('By cycle', 'Kwa mzunguko'),
  'access-requests': both('Access requests', 'Maombi ya kuona'),
  'national-totals': both('National totals', 'Jumla ya kitaifa'),
};
export const tableName = (table: OpenDataTableName, language: Language) =>
  TABLE_NAMES[table][language];

const KINDS: Record<ReleaseKind, { en: string; sw: string }> = {
  annual: both('Annual', 'La mwaka'),
  snapshot: both('Mid-year snapshot', 'Muhtasari wa katikati ya mwaka'),
};
export const kindName = (kind: ReleaseKind, language: Language) => KINDS[kind][language];

const CYCLES: Record<Cycle, { en: string; sw: string }> = {
  initial: both('Initial', 'Awali'),
  biennial: both('Biennial', 'Kila miaka miwili'),
  final: both('Final', 'Mwisho'),
  all: both('All cycles', 'Mizunguko yote'),
};
export const cycleName = (cycle: Cycle, language: Language) => CYCLES[cycle][language];

const REPORT_STATUSES: Record<ReportStatus, { en: string; sw: string }> = {
  'not-reported': both('Not reported', 'Haijaripoti'),
  'submitted-on-time': both('On time', 'Kwa wakati'),
  'submitted-late': both('Late', 'Kwa kuchelewa'),
};
export const reportStatusName = (status: ReportStatus, language: Language) =>
  REPORT_STATUSES[status][language];

/** A dataset column: its words in both languages, and the group it sits under on screen. */
export interface ColumnWords {
  en: string;
  sw: string;
  group?: { en: string; sw: string };
}

const DETERMINATIONS = both('Determinations', 'Maamuzi');
const CLARIFICATIONS = both('Clarifications', 'Ufafanuzi');
const ACTIONS = both('Administrative actions', 'Hatua za kiutawala');

/** Every column of the six tables (#491 `tables.ts`), the marker included. */
export const COLUMN_WORDS: Record<string, ColumnWords> = {
  commission: both('Commission code', 'Nambari ya Tume'),
  commissionName: both('Commission', 'Tume'),
  reportStatus: both('Form M report', 'Ripoti ya Fomu M'),
  cycle: both('Cycle', 'Mzunguko'),
  entityType: both('Reporting entity type', 'Aina ya shirika la kuripoti'),
  expected: both('Expected', 'Wanaotarajiwa'),
  filed: both('Declared', 'Walitamka'),
  nonFilers: both('Did not declare', 'Hawakutamka'),
  filingRate: both('Declaration rate', 'Kiwango cha matamko'),
  determinationsCompliant: { ...both('Compliant', 'Wametii'), group: DETERMINATIONS },
  determinationsNonCompliant: { ...both('Non-compliant', 'Hawajatii'), group: DETERMINATIONS },
  determinationsFurtherAction: { ...both('Further action', 'Hatua zaidi'), group: DETERMINATIONS },
  clarificationsIssued: { ...both('Issued', 'Yaliyotolewa'), group: CLARIFICATIONS },
  clarificationsResolved: { ...both('Resolved', 'Yaliyotatuliwa'), group: CLARIFICATIONS },
  actionsNoticeToComply: { ...both('Notice to comply', 'Notisi ya kutii'), group: ACTIONS },
  actionsWarning: { ...both('Warning', 'Onyo'), group: ACTIONS },
  actionsSalaryStoppage: { ...both('Salary stoppage', 'Kusimamisha mshahara'), group: ACTIONS },
  actionsDisciplinaryReferral: {
    ...both('Disciplinary referral', 'Rufaa ya kinidhamu'),
    group: ACTIONS,
  },
  referrals: both('Referrals to EACC', 'Rufaa kwa EACC'),
  received: both('Received', 'Yaliyopokelewa'),
  granted: both('Granted', 'Yamekubaliwa'),
  declined: both('Declined', 'Yamekataliwa'),
  measure: both('Measure', 'Kipimo'),
  value: both('Value', 'Thamani'),
  suppressed: both(
    'Not shown to protect privacy (_suppressed in CSV)',
    'Haionyeshwi ili kulinda faragha (_suppressed kwenye CSV)',
  ),
  complianceRate: both('Compliance rate', 'Kiwango cha utiifu'),
};

/** A column's words; a column the contract adds reads as its key until it has some. */
export function columnWords(column: string): ColumnWords {
  return COLUMN_WORDS[column] ?? { en: column, sw: column };
}

const MEASURES: Record<NationalMeasure, { en: string; sw: string }> = {
  commissions: both('Responsible Commissions', 'Tume Husika'),
  commissionsReported: both('Commissions that reported', 'Tume zilizoripoti'),
  commissionsReportedOnTime: both('Reported on time', 'Ziliripoti kwa wakati'),
  commissionsReportedLate: both('Reported late', 'Ziliripoti kwa kuchelewa'),
  commissionsNotReported: both('Not reported', 'Hazikuripoti'),
  reportingRate: both('Reporting rate', 'Kiwango cha kuripoti'),
  expected: both('Declarations expected', 'Matamko yaliyotarajiwa'),
  filed: both('Declarations made', 'Matamko yaliyofanywa'),
  nonFilers: both('Declarations not made', 'Matamko yasiyofanywa'),
  filingRate: both('Declaration rate', 'Kiwango cha matamko'),
  clarificationsIssued: both('Clarifications issued', 'Ufafanuzi uliotolewa'),
  clarificationsResolved: both('Clarifications resolved', 'Ufafanuzi uliotatuliwa'),
  determinationsCompliant: both('Determinations: compliant', 'Maamuzi: wametii'),
  determinationsNonCompliant: both('Determinations: non-compliant', 'Maamuzi: hawajatii'),
  determinationsFurtherAction: both('Determinations: further action', 'Maamuzi: hatua zaidi'),
  actionsNoticeToComply: both('Notices to comply', 'Notisi za kutii'),
  actionsWarning: both('Warnings', 'Maonyo'),
  actionsSalaryStoppage: both('Salary stoppages', 'Kusimamishwa kwa mishahara'),
  actionsDisciplinaryReferral: both('Disciplinary referrals', 'Rufaa za kinidhamu'),
  referrals: both('Referrals to EACC', 'Rufaa kwa EACC'),
  accessRequestsReceived: both('Access requests received', 'Maombi ya kuona yaliyopokelewa'),
  accessRequestsGranted: both('Access requests granted', 'Maombi ya kuona yaliyokubaliwa'),
  accessRequestsDeclined: both('Access requests declined', 'Maombi ya kuona yaliyokataliwa'),
};
export const measureName = (measure: string, language: Language) =>
  (MEASURES as Record<string, { en: string; sw: string } | undefined>)[measure]?.[language] ??
  measure;

/** Defined terms, in both languages at once: About this data is the bilingual glossary. */
export const GLOSSARY: { term: { en: string; sw: string }; meaning: { en: string; sw: string } }[] =
  [
    {
      term: both('Declaration rate', 'Kiwango cha matamko'),
      meaning: both(
        'Declarations made as a share of declarations expected.',
        'Matamko yaliyofanywa kama sehemu ya yaliyotarajiwa.',
      ),
    },
    {
      term: both('Compliance rate', 'Kiwango cha utiifu'),
      meaning: both(
        'Compliant determinations as a share of all compliance determinations.',
        'Maamuzi ya utiifu kama sehemu ya maamuzi yote ya utiifu.',
      ),
    },
    {
      term: both('Responsible Commission', 'Tume Husika'),
      meaning: both(
        'The body that receives and reviews the declarations of its public officers.',
        'Chombo kinachopokea na kukagua matamko ya maafisa wake wa umma.',
      ),
    },
    {
      term: both('Reporting entity', 'Shirika la kuripoti'),
      meaning: both(
        'The public body a declarant works for.',
        'Shirika la umma ambalo mtoa tamko hufanyia kazi.',
      ),
    },
    {
      term: both('Cycle', 'Mzunguko'),
      meaning: both(
        'Initial (on joining), biennial (every two years) or final (on leaving).',
        'Awali (unapojiunga), kila miaka miwili, au mwisho (unapoondoka).',
      ),
    },
    {
      term: both('Compliance determination', 'Uamuzi wa utiifu'),
      meaning: both(
        'The decision that a declaration is compliant, non-compliant or needs further action.',
        'Uamuzi kwamba tamko limetii, halijatii au linahitaji hatua zaidi.',
      ),
    },
    {
      term: both('Administrative action', 'Hatua ya kiutawala'),
      meaning: both(
        'A step for non-compliance, from a notice to comply up to a disciplinary referral.',
        'Hatua kwa kutotii, kuanzia notisi ya kutii hadi rufaa ya kinidhamu.',
      ),
    },
    {
      term: both('Referral', 'Rufaa'),
      meaning: both(
        'A matter sent to EACC for investigation.',
        'Suala lililopelekwa EACC kwa uchunguzi.',
      ),
    },
    {
      term: both('Access request', 'Ombi la kuona'),
      meaning: both(
        'A request to see a declaration, made on Form K.',
        'Ombi la kuona tamko, kupitia Fomu K.',
      ),
    },
    {
      term: both('Suppressed figure', 'Takwimu iliyofichwa'),
      meaning: both(
        'A figure over fewer than 10 officers, or one that could reveal such a figure from a total. Shown as ‹10; empty in CSV.',
        'Takwimu ya maafisa chini ya 10, au inayoweza kufichua takwimu kama hiyo kutoka kwa jumla. Huonyeshwa kama ‹10; tupu kwenye CSV.',
      ),
    },
    {
      term: both('Mid-year snapshot', 'Muhtasari wa katikati ya mwaka'),
      meaning: both(
        'Figures EACC publishes during the year, before the annual release.',
        'Takwimu zinazochapishwa na EACC katikati ya mwaka, kabla ya chapisho la mwaka.',
      ),
    },
    {
      term: both('Version', 'Toleo'),
      meaning: both(
        'A corrected release is the next version. A withdrawn version stays online, marked withdrawn with its reason.',
        'Chapisho lililosahihishwa ni toleo linalofuata. Toleo lililoondolewa hubaki mtandaoni, likiwa na alama na sababu yake.',
      ),
    },
  ];

/** The shared primitives' words in Swahili (their English is the default). */
export const SWAHILI_MARKERS: SuppressionMarkerMessagesOverride = {
  suppressed: {
    text: () => 'Haionyeshwi ili kulinda faragha',
    title: (threshold) =>
      `Haionyeshwi ili kulinda faragha: inahusu maafisa chini ya ${String(threshold)}, au inaweza kufichua takwimu kama hiyo`,
  },
  'not-reported': {
    short: () => 'Haijaripoti',
    text: () => 'Tume haijaripoti kwa mwaka huu',
    title: () => 'Tume haijaripoti kwa mwaka huu',
  },
  'not-collected': {
    short: () => 'Haikusanywi',
    text: () => 'Bado haikusanywi',
    title: () => 'Bado haikusanywi: hakuna data inayowekwa kwa takwimu hii',
  },
};

export const SWAHILI_LEGEND: SuppressionLegendMessagesOverride = {
  sentence: (threshold) =>
    `Takwimu za maafisa chini ya ${String(threshold)}, na zinazoweza kuzifichua, hazionyeshwi ili kulinda faragha.`,
  cellsSuppressed: (count) => `${formatNumber(count)} zimefichwa`,
  keys: {
    suppressed: () => 'Hulinda faragha',
    'not-reported': () => 'Tume haijaripoti',
    'not-collected': () => 'Bado haikusanywi',
  },
};

export const SWAHILI_RELEASE_STATUS: Partial<ReleaseStatusBadgeMessages> = {
  published: 'Imechapishwa',
  withdrawn: 'Imeondolewa',
  preview: 'Onyesho la awali',
};
