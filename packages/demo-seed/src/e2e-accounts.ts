/**
 * `pnpm e2e:accounts [--resend]`: the real end-to-end test accounts (docs/demo-accounts.md), one
 * per role, at `<role>@$E2E_EMAIL_DOMAIN`. Idempotent: a second run changes nothing and sends no
 * email; `--resend` emails the setup link again to the staff and law-enforcement accounts that
 * have not finished setting up. Needs a seeded stack (the PSC reporting officer and the platform
 * admin demo accounts act for it). On the hosted demo: the "Azure demo command" workflow,
 * `e2e-accounts` (infra/azure/demo-command.sh), which takes the domain from the host's SMTP
 * settings.
 */
import { parseArgs } from 'node:util';

import { loadConfig } from './config.js';
import { createContext } from './context.js';
import {
  type AccountReport,
  applicantReport,
  checkDomain,
  e2eAccounts,
  e2ePeople,
  ensureDeclarant,
  ensureLawEnforcementAccount,
  ensureStaffAccount,
  reportTable,
} from './e2e/accounts.js';
import { demoTicketSignIn, Tokens } from './tokens.js';

const { values } = parseArgs({ options: { resend: { type: 'boolean', default: false } } });
const resend = values.resend;
const domain = checkDomain(process.env.E2E_EMAIL_DOMAIN);
const config = loadConfig();
const context = createContext(config, new Tokens(demoTicketSignIn(config)), (message) => {
  console.log(message);
});
// The links in setup emails lead to the console as browsers reach it (the hosted one's public URL).
const consoleUrl = new URL(config.DEMO_CONSOLE_SIGN_IN_REDIRECT_URI).origin;

const reports: AccountReport[] = [];
const people = await e2ePeople(config.MOCKS_URL, domain);
for (const account of e2eAccounts(domain)) {
  switch (account.kind) {
    case 'staff':
      reports.push(await ensureStaffAccount(context.keycloak, account, { consoleUrl, resend }));
      break;
    case 'law-enforcement':
      reports.push(
        await ensureLawEnforcementAccount(await context.as('platform-admin'), account, {
          resend,
        }),
      );
      break;
    case 'declarant':
      reports.push(
        await ensureDeclarant(await context.as('reporting-officer'), account, people.declarant),
      );
      break;
    case 'applicant':
      reports.push(await applicantReport(context.keycloak, account, people.applicant));
      break;
  }
}

console.log(reportTable(reports));
const changed = reports.reduce((sum, report) => sum + report.changed, 0) + people.created;
console.log(changed === 0 ? 'unchanged' : 'changed');
