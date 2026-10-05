import { describe, expect, it } from 'vitest';

import { languageSchema } from '../language';
import { type AskTopic, suggestedQuestions } from './suggested';

const TOPICS: readonly AskTopic[] = [
  'home',
  'overview',
  'bio',
  'household',
  'income',
  'assets',
  'liabilities',
  'other',
  'summary',
];

describe('suggested questions', () => {
  // #684: every declarant sees the same chips, so none may assume the declarant's gender.
  it.each(TOPICS)('on %s never assume whom the declarant is married to', (topic) => {
    for (const language of languageSchema.options) {
      for (const question of suggestedQuestions(topic, language)) {
        expect(question).not.toMatch(/\b(wife|husband|wives|husbands)\b|\b(mke|mume)\b/i);
      }
    }
  });
});
