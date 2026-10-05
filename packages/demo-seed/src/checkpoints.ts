/**
 * `pnpm demo:checkpoints [--from <checkpoint>]`: captures the demo's checkpoints (#621) on a
 * seeded stack (`pnpm demo:seed` first), playing each beat between them through the APIs:
 *
 * - `0-start`: the seed as it is.
 * - `1-after-filing`: Wanjiku's live filing, as `rehearse` plays it (registries, the sample
 *   files read into the form, submit), until her case has its registry flags and its copilot.
 * - `2-after-review`: the reviewer claims her case and issues a clarification on two of them.
 * - `3-form-m-ready`: PSC's supervisor compiles Form M and marks it reviewed, so the Commission
 *   admin confirms it live.
 *
 * Capture runs with the stack up (a few seconds' freeze). It leaves the stack at the last
 * checkpoint: reset to `0-start` before the demo (`pnpm demo:reset 0-start`, with `pnpm dev`
 * stopped on a local stack; the Azure host restarts its apps itself).
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { DEMO_CHECKPOINTS } from '@adili/demo-auth/checkpoints';

import { ok } from './clients/api.js';
import { waitFor } from './clients/http.js';
import { loadConfig } from './config.js';
import { createContext, type SeedContext } from './context.js';
import { CURRENT_CYCLE } from './data/personas.js';
import { REPO_ROOT } from './repo.js';
import { demoTicketSignIn, Tokens } from './tokens.js';

/** The financial year Form M is compiled for: both demo cycles fall in FY 2025/26. */
export const FORM_M_FY = 2025;

/** What brings the stack from the checkpoint before to this one. */
const BEATS: Record<string, (context: SeedContext) => Promise<void>> = {
  '0-start': () => Promise.resolve(),
  '1-after-filing': fileWanjiku,
  '2-after-review': issueWanjikuClarification,
  '3-form-m-ready': prepareFormM,
};

const { values } = parseArgs({ options: { from: { type: 'string' } } });
const names = DEMO_CHECKPOINTS.map((checkpoint) => checkpoint.name);
const from = values.from ?? names[0];
if (!from || !names.includes(from)) {
  throw new Error(`--from takes a checkpoint: ${names.join(', ')}`);
}

const config = loadConfig();
const context = createContext(config, new Tokens(demoTicketSignIn(config)), console.log);

for (const name of names.slice(names.indexOf(from))) {
  const beat = BEATS[name];
  if (!beat) throw new Error(`No beat leads to ${name}`);
  console.log(`\n== ${name}`);
  await beat(context);
  checkpointScript('capture', name);
}
console.log(
  '\nCheckpoints captured; the stack is at the last one. Before the demo: pnpm demo:reset 0-start',
);

function checkpointScript(...args: string[]): void {
  const result = spawnSync(join(REPO_ROOT, 'scripts/demo-checkpoint.sh'), args, {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`scripts/demo-checkpoint.sh ${args.join(' ')} failed`);
  }
}

/** The live filing beat, through `rehearse`, which also checks what the demo promises. */
async function fileWanjiku(context: SeedContext): Promise<void> {
  const result = spawnSync(
    process.execPath,
    [...process.execArgv, join(REPO_ROOT, 'packages/demo-seed/src/rehearse.ts')],
    { stdio: 'inherit', cwd: join(REPO_ROOT, 'packages/demo-seed') },
  );
  if (result.status !== 0) throw new Error('Wanjiku’s filing (rehearse) failed');
  const caseId = await wanjikuCase(context);
  const reviewer = await context.as('reviewer');
  // The reviewer's live beat opens on the copilot's summary: wait until it is there (or failed,
  // which the case shows with a Retry; the demo's replay fixtures cover it).
  await waitFor(
    'Wanjiku’s copilot',
    async () => {
      const copilot = ok(
        await reviewer.review.GET('/v1/review/cases/{caseId}/copilot', {
          params: { path: { caseId } },
        }),
        'copilot',
      );
      return copilot.status === 'pending' ? undefined : copilot.status;
    },
    { timeoutMs: 300_000, intervalMs: 3000 },
  );
}

async function wanjikuCase(context: SeedContext): Promise<string> {
  const reviewer = await context.as('reviewer');
  const page = ok(
    await reviewer.review.POST('/v1/commissions/{slug}/review/queue/search', {
      params: { path: { slug: 'psc' } },
      body: { search: 'Wanjiku', cycle: CURRENT_CYCLE },
    }),
    'queue search',
  );
  const item = page.items[0];
  if (!item) throw new Error('Wanjiku’s current case is not in the PSC queue');
  return item.id;
}

/** The reviewer asks Wanjiku about the Prado and the Kajiado parcel the registries hold. */
async function issueWanjikuClarification(context: SeedContext): Promise<void> {
  const caseId = await wanjikuCase(context);
  const reviewer = await context.as('reviewer');
  ok(
    await reviewer.review.POST('/v1/review/cases/{caseId}/claim', {
      params: { path: { caseId }, header: { 'Idempotency-Key': randomUUID() } },
    }),
    'claim Wanjiku’s case',
  );
  const draft = ok(
    await reviewer.review.POST('/v1/review/cases/{caseId}/clarifications', {
      params: { path: { caseId } },
      body: {
        items: [
          {
            requirement: 'provide-omitted',
            text: 'NTSA records a Toyota Land Cruiser Prado, KDK 482M, registered to you in 2023. Declare it under assets, or explain why it is not yours at the statement date.',
          },
          {
            requirement: 'explain-discrepancy',
            text: 'ArdhiSasa records a 2.0235 ha parcel in Kitengela, Kajiado County, in your name. Your declaration lists only the Ruiru parcel. Explain the difference.',
          },
        ],
      },
    }),
    'draft the clarification',
  );
  ok(
    await reviewer.review.POST('/v1/review/clarifications/{clarificationId}/issue', {
      params: {
        path: { clarificationId: draft.id },
        header: { 'Idempotency-Key': randomUUID() },
      },
    }),
    'issue the clarification',
  );
  await waitFor(
    'the clarification letter',
    async () => {
      const clarification = ok(
        await reviewer.review.GET('/v1/review/clarifications/{clarificationId}', {
          params: { path: { clarificationId: draft.id } },
        }),
        'clarification',
      );
      return clarification.letter?.status === 'issued' ? clarification : undefined;
    },
    { timeoutMs: 120_000, intervalMs: 2000 },
  );
}

/** PSC's Form M compiled and reviewed by the supervisor: ready for the admin to confirm. */
async function prepareFormM(context: SeedContext): Promise<void> {
  const supervisor = await context.as('supervisor');
  const path = { slug: 'psc', fy: FORM_M_FY };
  const read = async () => {
    const result = await supervisor.reporting.GET(
      '/v1/commissions/{slug}/compliance-reports/{fy}',
      { params: { path } },
    );
    // No report for the year until the first compile.
    return result.response.status === 404 ? undefined : ok(result, 'PSC Form M');
  };
  if ((await read())?.status === 'reviewed') return;
  ok(
    await supervisor.reporting.POST('/v1/commissions/{slug}/compliance-reports/{fy}/compile', {
      params: { path },
    }),
    'compile PSC Form M',
  );
  await waitFor(
    'PSC Form M compiled',
    async () => {
      const report = await read();
      return report?.status === 'draft' ? report : undefined;
    },
    { timeoutMs: 300_000, intervalMs: 3000 },
  );
  ok(
    await supervisor.reporting.POST('/v1/commissions/{slug}/compliance-reports/{fy}/reviewed', {
      params: { path },
      body: { designation: 'Supervisor, Compliance' },
    }),
    'mark PSC Form M reviewed',
  );
}
