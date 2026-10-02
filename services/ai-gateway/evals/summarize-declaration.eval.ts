import { summarizeSuite } from './golden/summarize-declaration.js';
import { evalSuite } from './lib/suite.js';

evalSuite(summarizeSuite);
