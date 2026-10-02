import type { EvalSuite } from '../lib/suite.js';
import { answerSuite } from './answer-declarant-question.js';
import { draftSuite } from './draft-clarification.js';
import { explainSuite } from './explain-flags.js';
import { narrateSuite } from './narrate-compliance-report.js';
import { summarizeSuite } from './summarize-declaration.js';

/** Every task's evaluation set (spec 07c S9, 09b S10, 11 S11). A new task's suite is added here. */
export const SUITES: readonly EvalSuite<unknown>[] = [
  summarizeSuite,
  explainSuite,
  draftSuite,
  narrateSuite,
  answerSuite,
];
