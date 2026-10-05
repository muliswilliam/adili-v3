// Verifies the audit trail's chains from the command line (ADR-008 Pipeline step 6), as the
// daily anchoring does: every chain, or one tenant's or one day's, and each anchor's signature.
// Exits 1 when any chain was tampered with.
//
//     pnpm --filter @adili/audit audit:verify [--tenant psc] [--day 2026-10-05]
import { parseArgs } from 'node:util';

import { createDatabase } from '@adili/data-access';
import { and, eq, gt, type SQL } from 'drizzle-orm';

import { AnchorArchive } from './anchoring/archive.js';
import { Anchoring } from './anchoring/anchoring.js';
import { OpenBaoAnchorSigner } from './anchoring/openbao-signer.js';
import { config } from './config.js';
import { auditChainHeads, schema } from './db/schema.js';
import { ChainVerifier } from './trail/verifier.js';

const { values: args } = parseArgs({
  options: { tenant: { type: 'string' }, day: { type: 'string' } },
});

/** Verification reads only: nothing is archived. */
class NoArchive extends AnchorArchive {
  put(): Promise<void> {
    return Promise.reject(new Error('verification writes nothing'));
  }
  check(): Promise<void> {
    return Promise.resolve();
  }
}

const db = createDatabase({ url: config.DATABASE_URL, schema, applicationName: 'audit-verify' });
const anchoring = new Anchoring(
  db,
  new ChainVerifier(db),
  new OpenBaoAnchorSigner({
    url: config.OPENBAO_ADDR,
    token: config.OPENBAO_TOKEN,
    key: config.AUDIT_ANCHOR_KEY,
  }),
  new NoArchive(),
);

const filters: SQL[] = [gt(auditChainHeads.seq, 0)];
if (args.tenant) filters.push(eq(auditChainHeads.tenant, args.tenant));
if (args.day) filters.push(eq(auditChainHeads.chainDay, args.day));
const chains = await db
  .select({ tenant: auditChainHeads.tenant, chainDay: auditChainHeads.chainDay })
  .from(auditChainHeads)
  .where(and(...filters))
  .orderBy(auditChainHeads.chainDay, auditChainHeads.tenant);

let tampered = 0;
for (const chain of chains) {
  const result = await anchoring.verify(chain);
  if (result.status === 'tampered') tampered += 1;
  const problems = result.problems.map(
    (p) => `${p.kind}${p.seq === null ? '' : `@${String(p.seq)}`}`,
  );
  console.log(
    `${result.chainDay} ${result.tenant.padEnd(12)} ${String(result.events).padStart(7)} events  ` +
      `anchor ${result.anchor.status.padEnd(8)} ${result.status}${problems.length ? ` (${problems.join(', ')})` : ''}`,
  );
}
console.log(`${String(chains.length)} chains verified, ${String(tampered)} tampered`);
await db.$client.end();
process.exitCode = tampered > 0 ? 1 : 0;
