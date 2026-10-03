import { extractSuite } from './golden/extract-document.js';
import { evalSuite } from './lib/suite.js';

evalSuite(extractSuite);
