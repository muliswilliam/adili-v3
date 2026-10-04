import type { Language } from '../language';

/**
 * Where the declarant is, as far as Ask Adili's suggestions go: the dashboard, a workspace
 * screen, or a tab of a financial statement.
 */
export type AskTopic =
  | 'home'
  | 'overview'
  | 'bio'
  | 'household'
  | 'income'
  | 'assets'
  | 'liabilities'
  | 'other'
  | 'summary';

/**
 * Curated questions per topic, in both languages (spec 11: "static per section"). The popular
 * questions from the Commission's question log join these once the suggestions endpoint is built
 * (#339).
 */
const SUGGESTED: Record<AskTopic, Record<Language, readonly string[]>> = {
  home: {
    en: [
      'When is my declaration due?',
      'Who do I declare for?',
      'What counts as a material change?',
    ],
    sw: [
      'Tamko langu linapaswa kuwasilishwa lini?',
      'Ninatangaza kwa ajili ya nani?',
      'Mabadiliko makubwa ni nini?',
    ],
  },
  overview: {
    en: ['Who do I declare for?', 'When is my declaration due?'],
    sw: ['Ninatangaza kwa ajili ya nani?', 'Tamko langu linapaswa kuwasilishwa lini?'],
  },
  bio: {
    en: ["What does 'nature of employment' mean?", 'Where do I find my personnel file number?'],
    sw: ["Nitaandika nini kwenye 'aina ya ajira'?", 'Nitapata wapi nambari yangu ya faili?'],
  },
  household: {
    en: ["Do I declare my wife's salary?", 'Do I include a child who turned 18?'],
    sw: ['Je, nitaje mshahara wa mke wangu?', 'Je, nimjumuishe mtoto aliyetimiza miaka 18?'],
  },
  income: {
    en: ["Do I declare my wife's salary?", 'What counts as a material change?'],
    sw: ['Je, nitaje mshahara wa mke wangu?', 'Mabadiliko makubwa ni nini?'],
  },
  assets: {
    en: [
      'Is a matatu I co-own with my brother an asset?',
      'How do I value my car?',
      "Do I include my late father's land that has not been transferred?",
    ],
    sw: [
      'Je, matatu ninayomiliki pamoja na kaka yangu ni mali?',
      'Nitathaminije gari langu?',
      'Je, nitaje ardhi ya marehemu baba yangu ambayo bado haijahamishwa?',
    ],
  },
  liabilities: {
    en: ['Do I declare my SACCO loan?', 'Do I declare a loan I guaranteed for a friend?'],
    sw: ['Je, nitaje mkopo wangu wa SACCO?', 'Je, nitaje mkopo niliomdhamini rafiki?'],
  },
  other: {
    en: ['What counts as a material change?', 'Where do I declare a directorship?'],
    sw: ['Mabadiliko makubwa ni nini?', 'Nitaje wapi ukurugenzi wangu?'],
  },
  summary: {
    en: ['Can I change my declaration after I submit?', 'When is my declaration due?'],
    sw: [
      'Je, naweza kubadilisha tamko langu baada ya kuwasilisha?',
      'Tamko langu linapaswa kuwasilishwa lini?',
    ],
  },
};

export function suggestedQuestions(topic: AskTopic, language: Language): readonly string[] {
  return SUGGESTED[topic][language];
}
