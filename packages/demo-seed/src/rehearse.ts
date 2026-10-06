/**
 * `pnpm --filter @adili/demo-seed rehearse`: runs the demo's live filing beat end to end through
 * the APIs, as the presenter does it in the portal, and checks what the demo promises (#617):
 *
 * 1. Wanjiku opens her current declaration, which `0-start` leaves holding what carries over from
 *    her previous one (her salary, without its amount, and her Sacco loan), and asks the
 *    registries: NTSA and ArdhiSasa suggest her Fielder and her Kiambu parcel, KRA hints at her
 *    income.
 * 2. She accepts the Fielder and the parcel, attaches the sample files (`mocks/demo/files`) and
 *    has each read into the form (the AI provider's `extract-document`), the payslip into her
 *    carried-over salary.
 * 3. She submits; the reviewer's case then shows the three 07b flags (the Prado, the Kajiado
 *    parcel, Afya Bora supplying KEMSA) and the comparison with her previous declaration, and no
 *    comparison flag: what she carried over pairs with what she declared before (#704).
 *
 * It files Wanjiku's declaration, which `0-start` leaves for the live demo: run it on a stack you
 * reset to `0-start` afterwards (an empty stack and `pnpm demo:seed` until #621's checkpoints),
 * never right before a demo.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ok } from './clients/api.js';
import { waitFor } from './clients/http.js';
import { uploadFile } from './clients/uploads.js';
import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { CURRENT_CYCLE, PERSONAS } from './data/personas.js';
import { fixtureRoster } from './data/roster.js';
import { declarantState, startCarriedOver } from './filing.js';
import { REPO_ROOT } from './repo.js';
import { demoTicketSignIn, Tokens } from './tokens.js';

const config = loadConfig();
const context = createContext(config, new Tokens(demoTicketSignIn(config)), console.log);
const failures: string[] = [];
const expect = (what: string, holds: boolean) => {
  console.log(`${holds ? 'PASS' : 'FAIL'} ${what}`);
  if (!holds) failures.push(what);
};

const wanjiku = PERSONAS.find((p) => p.demoKey === 'wanjiku');
const row = fixtureRoster('psc').find((r) => r.nationalId === wanjiku?.nationalId);
if (!wanjiku || !row) throw new Error('Wanjiku is missing from the personas');

const api = await context.as('wanjiku');
const { obligations, declarations } = await declarantState(api);
const obligation = obligations.find((o) => o.cycleKey === `biennial:${String(CURRENT_CYCLE)}`);
if (!obligation) throw new Error('Wanjiku has no current-cycle obligation');
if (declarations.some((d) => d.obligationId === obligation.id && d.status === 'submitted')) {
  throw new Error('Wanjiku filed her current declaration already: reset to 0-start first');
}
const declarant = {
  demoKey: wanjiku.demoKey,
  birth: { date: row.dateOfBirth, place: row.placeOfBirth },
};
const previous = wanjiku.filings.previous;
// `0-start` leaves her draft holding what carries over from her previous declaration (#682). A
// draft an earlier rehearsal got further with is discarded and started again the same way.
let current = declarations.find((d) => d.obligationId === obligation.id && d.status === 'draft');
if (current) {
  const statement = ok(
    await api.declarations.GET('/v1/declarations/{declarationId}/sections/{sectionKey}', {
      params: { path: { declarationId: current.id, sectionKey: 'statement:officer' } },
    }),
    'statement',
  ).contents as { income?: unknown[]; assets?: unknown[] };
  if ((statement.income?.length ?? 0) + (statement.assets?.length ?? 0) > 0) {
    ok(
      await api.declarations.DELETE('/v1/declarations/{declarationId}', {
        params: { path: { declarationId: current.id } },
      }),
      'discard an earlier rehearsal',
    );
    current = undefined;
  }
}
const { declarationId } = await startCarriedOver(context, declarant, obligation, current, previous);
const path = { declarationId };
const version = async () =>
  String(
    ok(
      await api.declarations.GET('/v1/declarations/{declarationId}', { params: { path } }),
      'draft',
    ).draftVersion,
  );

const systems = ['kra', 'ntsa', 'brs', 'ardhisasa'] as const;
ok(
  await api.declarations.POST('/v1/declarations/{declarationId}/suggestions/lookups', {
    params: { path, header: { 'Idempotency-Key': randomUUID() } },
    body: {
      personKey: 'officer',
      systems: [...systems],
      consent: { requested: true, textVersion: `registry-consent.v1:${systems.join('+')}` },
    },
  }),
  'check registries',
);
const settled = async () => {
  const sets = ok(
    await api.declarations.GET('/v1/declarations/{declarationId}/suggestions', {
      params: { path },
    }),
    'suggestions',
  );
  return sets.some((set) => set.status === 'pending') ? undefined : sets;
};
let sets = await waitFor('registry suggestions', settled, { timeoutMs: 120_000 });
const registry = sets.filter((set) => set.source !== 'document').flatMap((set) => set.suggestions);
const offered = (identifier: string) =>
  registry.find((s) => JSON.stringify(s.fields).includes(identifier));
expect('Check registries offers the Fielder KCX 214J', offered('KCX 214J') !== undefined);
expect('Check registries offers the Kiambu parcel', offered('KIAMBU/RUIRU') !== undefined);

// Accept the Fielder and the parcel; each becomes an item to attach a file to. KRA's income hint
// is for checking the salary she carried over, so it is left as a hint.
const accept = async (
  suggestionId: string,
  fields: Record<string, unknown>,
  applyToItemId: string | null,
  overwrite = true,
) =>
  ok(
    await api.declarations.POST(
      '/v1/declarations/{declarationId}/suggestions/{suggestionId}/accept',
      {
        params: { path: { declarationId, suggestionId }, header: { 'If-Match': await version() } },
        body: { fields, applyToItemId, overwrite },
      },
    ),
    `accept ${suggestionId}`,
  );
const carried = ok(
  await api.declarations.GET('/v1/declarations/{declarationId}/sections/{sectionKey}', {
    params: { path: { declarationId, sectionKey: 'statement:officer' } },
  }),
  'carried-over statement',
).contents as { income?: { id: string; type: string }[] };
const salaryId = carried.income?.find((item) => item.type === 'salary-emoluments')?.id;
expect('the salary is carried over from her previous declaration', salaryId !== undefined);
const items: Record<string, string> = salaryId ? { salary: salaryId } : {};
for (const [key, suggestion] of [
  ['vehicle', offered('KCX 214J')],
  ['land', offered('KIAMBU/RUIRU')],
] as const) {
  if (!suggestion) continue;
  // A vehicle or land suggestion always adds an item; only IPRS's birth (the bio's) names none.
  const { itemId } = await accept(suggestion.id, suggestion.fields, null);
  expect(`the ${key} is added as an item`, itemId !== null);
  if (itemId) items[key] = itemId;
}

// Read each sample file into its item.
// As the presenter does: "Use what was read" on the logbook only, so the salary keeps the
// description she declared it under before.
const files = [
  {
    key: 'salary',
    file: 'payslip-kemsa-june-2026.pdf',
    type: 'application/pdf',
    kind: 'payslip',
    overwrite: false,
  },
  {
    key: 'vehicle',
    file: 'logbook-fielder-kcx-214j.jpg',
    type: 'image/jpeg',
    kind: 'logbook',
    overwrite: true,
  },
  {
    key: 'land',
    file: 'title-deed-kiambu-ruiru.pdf',
    type: 'application/pdf',
    kind: 'title-deed',
    overwrite: false,
  },
] as const;
for (const sample of files) {
  const itemId = items[sample.key];
  if (!itemId) {
    expect(`${sample.file}: an item to attach it to`, false);
    continue;
  }
  const uploadId = await uploadFile(api, {
    purpose: 'declaration-attachment',
    contentType: sample.type,
    fileName: sample.file,
    bytes: readFileSync(join(REPO_ROOT, 'mocks/demo/files', sample.file)),
  });
  const attachment = ok(
    await api.declarations.POST('/v1/declarations/{declarationId}/attachments', {
      params: { path },
      body: { sectionKey: 'statement:officer', itemId, uploadId },
    }),
    `attach ${sample.file}`,
  );
  // "Try again", as the portal offers, while the gateway is busy (the copilot's backlog).
  await waitFor(
    `${sample.file} taken for reading`,
    async () => {
      const read = await api.declarations.POST(
        '/v1/declarations/{declarationId}/attachments/{attachmentId}/extract',
        {
          params: {
            path: { declarationId, attachmentId: attachment.id },
            header: { 'Idempotency-Key': randomUUID() },
          },
          body: { documentKindHint: sample.kind, language: 'en' },
        },
      );
      if (read.response.status === 503) return undefined;
      return ok(read, `read ${sample.file}`);
    },
    { timeoutMs: 300_000, intervalMs: 5000 },
  );
  sets = await waitFor(`reading of ${sample.file}`, settled, { timeoutMs: 180_000 });
  const reading = sets.find((set) => set.attachmentId === attachment.id);
  const suggestion = reading?.suggestions[0];
  expect(
    `${sample.file} is read into the form (${reading?.status ?? 'no set'}${reading?.reason ? `: ${reading.reason}` : ''})`,
    reading?.status === 'ready' && suggestion !== undefined,
  );
  if (suggestion) {
    console.log(`    read: ${JSON.stringify(suggestion.fields)}`);
    await accept(suggestion.id, suggestion.fields, itemId, sample.overwrite);
  }
}

// The values the presenter types (docs/demo/README.md, beat D), then submit with a fresh sign-in;
// the rest carried over.
const statement = ok(
  await api.declarations.GET('/v1/declarations/{declarationId}/sections/{sectionKey}', {
    params: { path: { declarationId, sectionKey: 'statement:officer' } },
  }),
  'statement',
).contents as Record<string, unknown> & {
  income?: Record<string, unknown>[];
  assets?: Record<string, unknown>[];
};
const unchanged = { changed: false };
const withValue = (item: Record<string, unknown>, field: 'value' | 'amount', kes: number) =>
  (item[field] as { kesCents?: number } | undefined)?.kesCents
    ? item
    : { ...item, [field]: { kesCents: kes * 100 } };
ok(
  await api.declarations.PUT('/v1/declarations/{declarationId}/sections/{sectionKey}', {
    params: {
      path: { declarationId, sectionKey: 'statement:officer' },
      header: { 'If-Match': await version() },
    },
    body: {
      ...statement,
      incomeNil: false,
      income: (statement.income ?? []).map((i) => ({
        change: unchanged,
        location: { inKenya: true, county: '047' },
        ...withValue(i, 'amount', 6_240_000),
      })),
      assetsNil: (statement.assets ?? []).length === 0,
      assets: (statement.assets ?? []).map((a) => ({
        change: unchanged,
        joint: { isJoint: false },
        location: { inKenya: true, county: '022' },
        ...withValue(a, 'value', a.type === 'land' ? 4_000_000 : 1_000_000),
      })),
    },
  }),
  'save the statement',
);
const fresh = await context.as('wanjiku', { fresh: true });
const submitted = await fresh.declarations.POST('/v1/declarations/{declarationId}/submit', {
  params: { path, header: { 'Idempotency-Key': randomUUID() } },
});
expect(
  `submit (${String(submitted.response.status)} ${JSON.stringify(submitted.error ?? '')})`,
  submitted.response.ok,
);

// The reviewer's case: registry flags once the check has run, and the comparison.
const reviewer = await context.as('reviewer');
const found = await waitFor(
  'Wanjiku’s case with its registry check',
  async () => {
    const page = ok(
      await reviewer.review.POST('/v1/commissions/{slug}/review/queue/search', {
        params: { path: { slug: 'psc' } },
        body: { search: 'Wanjiku', cycle: CURRENT_CYCLE },
      }),
      'queue search',
    );
    const item = page.items[0];
    if (!item) return undefined;
    const detail = ok(
      await reviewer.review.GET('/v1/review/cases/{caseId}', {
        params: { path: { caseId: item.id } },
      }),
      'case',
    );
    const rules = detail.flags.map((flag) => flag.ruleId as string);
    return rules.some((rule) => rule.startsWith('registry-')) ? { item, rules } : undefined;
  },
  { timeoutMs: 180_000, intervalMs: 2000 },
);
console.log(`    flags: ${found.rules.join(', ')}`);
for (const rule of [
  'registry-vehicle-undeclared',
  'registry-parcel-undeclared',
  'directorship-employer-supplier',
]) {
  expect(`07b flag ${rule}`, found.rules.includes(rule));
}
expect('compared with her previous declaration', !found.rules.includes('no-previous-version'));
// What she carried over pairs with her previous declaration and the typed values move less than
// 25%: the comparison flags nothing the story does not explain (#704).
const comparisonRules = [
  'acquisition-unflagged',
  'disposal-unflagged',
  'nil-after-populated',
  'value-change-25',
  'change-flag-mismatch',
  'income-vs-asset-growth',
];
expect('no comparison flag', !found.rules.some((rule) => comparisonRules.includes(rule)));
const compare = await reviewer.review.GET('/v1/review/cases/{caseId}/compare', {
  params: { path: { caseId: found.item.id } },
});
expect(
  `material-change comparison answers (${String(compare.response.status)})`,
  compare.response.ok,
);

if (failures.length > 0) {
  console.log(`\n${String(failures.length)} check(s) failed`);
  process.exit(1);
}
console.log('\nThe live filing beat works end to end');
