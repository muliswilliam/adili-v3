/**
 * `pnpm demo:seed [--only <step,...>] [--from <step>]`: brings the stack to the demo's starting
 * state (#371) through the services' APIs. Safe to run again: a second run changes nothing.
 */
import { parseArgs } from 'node:util';

import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { runSteps, selectSteps } from './run.js';
import { STEPS } from './steps/index.js';
import { demoTicketSignIn, Tokens } from './tokens.js';

const { values } = parseArgs({
  options: { only: { type: 'string' }, from: { type: 'string' }, list: { type: 'boolean' } },
});
if (values.list) {
  for (const step of STEPS) console.log(`${step.id.padEnd(20)} ${step.title}`);
  process.exit(0);
}

const config = loadConfig();
const context = createContext(config, new Tokens(demoTicketSignIn(config)), (message) => {
  console.log(message);
});
const started = performance.now();
const reports = await runSteps(
  context,
  selectSteps(STEPS, {
    only: values.only?.split(',').filter(Boolean),
    from: values.from,
  }),
);
const changed = reports.reduce((sum, report) => sum + report.changed, 0);
console.log(
  `Demo seed done in ${((performance.now() - started) / 1000).toFixed(0)}s: ${changed === 0 ? 'nothing changed' : `${String(changed)} changes`}`,
);
