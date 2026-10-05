import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Apis } from '../clients/api.js';
import { ok } from '../clients/api.js';
import { waitFor } from '../clients/http.js';
import type { SeedContext } from '../context.js';
import { EXPIRED_PACKAGE_MARKER } from '../data/access.js';
import { CURRENT_CYCLE } from '../data/personas.js';
import { syntheticOfficers } from '../data/synthetic.js';
import { REPO_ROOT } from '../repo.js';
import type { SeedStep } from '../step.js';
import { JSC_ACCESS_OFFICER } from './access.js';
import { syntheticPlans } from './filings.js';

/**
 * Where the seed writes what the demo script needs from a seeded stack: the verification codes
 * (they change with every seed from empty, not with a checkpoint restore) and the tampered PDF.
 * Gitignored, and kept by the hosted deploy's rsync.
 */
export const DEMO_OUTPUT_DIR = join(REPO_ROOT, '.demo');

const TAMPERED_PDF = 'tampered-acknowledgement-slip.pdf';
const WITHDRAWN_MARKER = 'Demo: issued in error and withdrawn';

export interface VerifyDocument {
  status: 'valid' | 'superseded' | 'revoked' | 'expired' | 'hash-mismatch';
  what: string;
  verificationId: string;
  verifyUrl: string;
  /** For `hash-mismatch`: the file under `.demo/` to drop on the verify page. */
  file?: string;
}

interface Slip {
  verificationId: string | null;
  verifyUrl: string | null;
  documentId: string | null;
}

async function slip(api: Apis, declarationId: string, version: number): Promise<Slip> {
  return waitFor(`slip of ${declarationId} v${String(version)}`, async () => {
    const found = ok(
      await api.declarations.GET(
        '/v1/declarations/{declarationId}/versions/{version}/acknowledgement',
        { params: { path: { declarationId, version } } },
      ),
      'acknowledgement',
    );
    return found.verificationId ? found : undefined;
  });
}

async function currentDeclaration(api: Apis, version?: number) {
  const mine = ok(await api.declarations.GET('/v1/me/declarations'), 'my declarations');
  const found = mine.find(
    (d) => d.status === 'submitted' && (version === undefined || d.currentVersion === version),
  );
  if (!found) throw new Error('No submitted declaration');
  return found;
}

/** The verify page of a verification code, from another document's verify URL (same origin). */
function verifyUrlOf(sample: string, verificationId: string): string {
  return `${new URL(sample).origin}/v/${verificationId}`;
}

/**
 * A JSC officer's case with a clarification issued in error and withdrawn: its letter is revoked
 * (the verify app shows it as such). Returns the letter's verification code and whether it acted.
 */
async function withdrawnLetter(
  context: SeedContext,
): Promise<{ verificationId: string; changed: number }> {
  const jsc = (await syntheticOfficers(context)).get('jsc') ?? [];
  const filers = jsc.filter((o) =>
    syntheticPlans(o).some((p) => p.cycleKey === `biennial:${String(CURRENT_CYCLE)}`),
  );
  // The second current-cycle filer: the first is the expiring access package's declarant.
  const officer = filers[1];
  if (!officer) throw new Error('Too few JSC officers filed the current cycle');
  const reviewer = await context.as('jsc-reviewer');
  const page = ok(
    await reviewer.review.POST('/v1/commissions/{slug}/review/queue/search', {
      params: { path: { slug: 'jsc' } },
      body: { search: officer.personnelFileNumber, cycle: CURRENT_CYCLE },
    }),
    `find ${officer.fullName}'s case`,
  );
  const listed = page.items[0];
  if (!listed) throw new Error(`${officer.fullName} has no ${String(CURRENT_CYCLE)} case`);
  const caseId = listed.id;
  const detail = async () =>
    ok(
      await reviewer.review.GET('/v1/review/cases/{caseId}', { params: { path: { caseId } } }),
      'case detail',
    );
  let changed = 0;
  let clarification = (await detail()).clarifications.find((c) =>
    c.items.some((i) => i.text.startsWith(WITHDRAWN_MARKER)),
  );
  if (!clarification) {
    const current = await detail();
    if (current.case.assignee === null) {
      ok(
        await reviewer.review.POST('/v1/review/cases/{caseId}/claim', {
          params: { path: { caseId }, header: { 'Idempotency-Key': randomUUID() } },
        }),
        'claim the case',
      );
      changed++;
    }
    clarification = ok(
      await reviewer.review.POST('/v1/review/cases/{caseId}/clarifications', {
        params: { path: { caseId }, header: { 'Idempotency-Key': randomUUID() } },
        body: {
          items: [
            {
              requirement: 'explain-discrepancy',
              text: `${WITHDRAWN_MARKER}: explain the change in your declared income since your previous declaration.`,
            },
          ],
        },
      }),
      'draft the clarification',
    );
    changed++;
  }
  const clarificationId = clarification.id;
  if (clarification.status === 'draft') {
    const fresh = await context.as('jsc-reviewer', { fresh: true });
    ok(
      await fresh.review.POST('/v1/review/clarifications/{clarificationId}/issue', {
        params: { path: { clarificationId }, header: { 'Idempotency-Key': randomUUID() } },
      }),
      'issue the clarification',
    );
    changed++;
  }
  const issued = await waitFor(
    'clarification letter issued',
    async () => {
      const current = ok(
        await reviewer.review.GET('/v1/review/clarifications/{clarificationId}', {
          params: { path: { clarificationId } },
        }),
        'clarification',
      );
      return current.letter && current.letter.status !== 'pending' ? current : undefined;
    },
    { timeoutMs: 120_000, intervalMs: 1000 },
  );
  if (issued.status !== 'withdrawn') {
    const fresh = await context.as('jsc-reviewer', { fresh: true });
    ok(
      await fresh.review.POST('/v1/review/clarifications/{clarificationId}/withdraw', {
        params: { path: { clarificationId }, header: { 'Idempotency-Key': randomUUID() } },
        body: { reason: 'Issued in error: the income change is explained in the declaration.' },
      }),
      'withdraw the clarification',
    );
    changed++;
  }
  const letter = issued.letter;
  if (!letter) throw new Error('The withdrawn clarification has no letter');
  return { verificationId: letter.verificationId, changed };
}

/** The code of the package granted on the JSC request (the one that expires). */
async function expiringPackage(context: SeedContext): Promise<string> {
  const officer = await context.as(JSC_ACCESS_OFFICER);
  const queue = ok(
    await officer.access.GET('/v1/commissions/{slug}/access/requests', {
      params: { path: { slug: 'jsc' } },
    }),
    'JSC access requests',
  );
  for (const item of queue.items.filter((i) => i.kind === 'form-k' && i.status === 'granted')) {
    const view = ok(
      await officer.access.GET('/v1/access/requests/{requestId}/officer', {
        params: { path: { requestId: item.id } },
      }),
      'JSC access request',
    );
    const reason = (view.formK as { partIII?: { reason?: string } }).partIII?.reason ?? '';
    if (reason.includes(EXPIRED_PACKAGE_MARKER) && view.package) {
      return view.package.verificationId;
    }
  }
  throw new Error('The JSC grant has no package yet; run the access step first');
}

/** Otieno's granted access package (PSC: in force for its download window). */
async function grantedPackage(context: SeedContext): Promise<string> {
  const otieno = await context.as('otieno');
  const notices = ok(await otieno.access.GET('/v1/me/access-notices'), 'my access notices');
  const granted = notices.find((n) => n.kind === 'form-k' && n.decision?.outcome === 'grant');
  if (!granted) throw new Error('Otieno has no granted request; run the access step first');
  const officer = await context.as('access-officer');
  const view = ok(
    await officer.access.GET('/v1/access/requests/{requestId}/officer', {
      params: { path: { requestId: granted.requestId } },
    }),
    'granted request',
  );
  if (!view.package) throw new Error('The granted request has no package yet');
  return view.package.verificationId;
}

/**
 * A copy of `documentId`'s PDF with a few bytes appended, as an edit saved over it would: it still
 * opens, but the verify page's file check reports that it does not match the issued document.
 * Written once per document.
 */
async function tamperedCopy(api: Apis, documentId: string, path: string): Promise<void> {
  const link = ok(
    await api.documents.GET('/v1/documents/{documentId}/download', {
      params: { path: { documentId } },
    }),
    'slip download link',
  );
  const response = await fetch(link.downloadUrl);
  if (!response.ok) throw new Error(`Downloading the slip: ${String(response.status)}`);
  const pdf = Buffer.from(await response.arrayBuffer());
  writeFileSync(path, Buffer.concat([pdf, Buffer.from('\n% edited after issue\n')]));
}

function markdown(documents: readonly VerifyDocument[]): string {
  const rows = documents.map(
    (d) =>
      `| ${d.status} | ${d.what} | \`${d.verificationId}\` | ${d.verifyUrl} | ${d.file ? `\`.demo/${d.file}\`` : ''} |`,
  );
  return [
    '# Verify statuses (generated by `pnpm demo:seed`)',
    '',
    'Codes change with every seed from an empty stack; a checkpoint restore keeps them.',
    '',
    '| Status | Document | Code | Verify page | File |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

/**
 * Verifiable documents in every status (#620, ADR-010): a valid slip and access package, Amina's
 * superseded version 1 slip, a revoked clarification letter, the JSC package that expires, and a
 * tampered copy of a slip whose hash does not match. Writes their codes and verify pages to
 * `.demo/verify.md` and `.demo/verify.json` for the demo script.
 */
export const verify: SeedStep = {
  id: 'verify',
  title: 'Verifiable documents in every status',
  async run(context) {
    const otieno = await context.as('otieno');
    const amina = await context.as('amina');
    const otienoDeclaration = await currentDeclaration(otieno);
    const valid = await slip(otieno, otienoDeclaration.id, otienoDeclaration.currentVersion ?? 1);
    const aminaDeclaration = await currentDeclaration(amina, 2);
    const superseded = await slip(amina, aminaDeclaration.id, 1);
    const revoked = await withdrawnLetter(context);
    const sample = valid.verifyUrl ?? '';
    if (!valid.verificationId || !valid.documentId || !superseded.verificationId) {
      throw new Error('Slips are not issued yet');
    }

    mkdirSync(DEMO_OUTPUT_DIR, { recursive: true });
    const jsonPath = join(DEMO_OUTPUT_DIR, 'verify.json');
    const tamperedPath = join(DEMO_OUTPUT_DIR, TAMPERED_PDF);
    const previous = existsSync(jsonPath)
      ? (JSON.parse(readFileSync(jsonPath, 'utf8')) as VerifyDocument[])
      : [];
    const tamperedBefore = previous.find((d) => d.status === 'hash-mismatch');
    if (!existsSync(tamperedPath) || tamperedBefore?.verificationId !== valid.verificationId) {
      await tamperedCopy(otieno, valid.documentId, tamperedPath);
    }

    const listed: VerifyDocument[] = [
      {
        status: 'valid',
        what: "Otieno Odhiambo's acknowledgement slip",
        verificationId: valid.verificationId,
        verifyUrl: sample,
      },
      {
        status: 'valid',
        what: "Access package granted on Otieno's declaration (watermarked, signed)",
        verificationId: await grantedPackage(context),
        verifyUrl: '',
      },
      {
        status: 'superseded',
        what: "Amina Hassan's version 1 slip, superseded by her amendment",
        verificationId: superseded.verificationId,
        verifyUrl: superseded.verifyUrl ?? '',
      },
      {
        status: 'revoked',
        what: 'JSC clarification letter, issued in error and withdrawn',
        verificationId: revoked.verificationId,
        verifyUrl: '',
      },
      {
        status: 'expired',
        what: 'JSC access package past its validity (the demo runs JSC packages short)',
        verificationId: await expiringPackage(context),
        verifyUrl: '',
      },
      {
        status: 'hash-mismatch',
        what: "Tampered copy of Otieno's slip: drop the file on its verify page",
        verificationId: valid.verificationId,
        verifyUrl: sample,
        file: TAMPERED_PDF,
      },
    ];
    const documents = listed.map((d) => ({
      ...d,
      verifyUrl: d.verifyUrl || verifyUrlOf(sample, d.verificationId),
    }));

    writeFileSync(jsonPath, `${JSON.stringify(documents, null, 2)}\n`);
    writeFileSync(join(DEMO_OUTPUT_DIR, 'verify.md'), markdown(documents));
    return {
      changed: revoked.changed,
      notes: documents.map((d) => `${d.status}: ${d.verificationId}`),
    };
  },
};
