import { narrateSuite } from './golden/narrate-compliance-report.js';
import { evalSuite } from './lib/suite.js';

evalSuite(narrateSuite);
