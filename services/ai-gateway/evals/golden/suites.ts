import type { EvalSuite } from '../lib/suite.js';
import { draftSuite } from './draft-clarification.js';
import { explainSuite } from './explain-flags.js';
import { summarizeSuite } from './summarize-declaration.js';

/** Every task's evaluation set (spec 07c S9). A new task's suite is added here. */
export const SUITES: readonly EvalSuite<unknown>[] = [summarizeSuite, explainSuite, draftSuite];
