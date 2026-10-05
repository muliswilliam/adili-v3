/**
 * `pnpm --filter @adili/demo-seed rehearse`: runs the demo's live filing beat end to end through
 * the APIs, as the presenter does it in the portal, and checks what the demo promises (#617):
 *
 * 1. Wanjiku starts her current declaration and asks the registries: KRA, NTSA, BRS and ArdhiSasa
 *    suggest her Fielder, her Kiambu parcel and her salary.
 * 2. She accepts them, attaches the sample files (`mocks/demo/files`) and has each read into the
 *    form (the AI provider's `extract-document`).
 * 3. She submits; the reviewer's case then shows the three 07b flags (the Prado, the Kajiado
 *    parcel, Afya Bora supplying KEMSA) and the comparison with her previous declaration.
 *
 * It files Wanjiku's declaration, which `0-start` leaves for the live demo: run it on a stack you
 * reset afterwards (`pnpm demo:reset 0-start`), never right before a demo.
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
import { declarantState } from './filing.js';
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
// A draft left by an earlier rehearsal is discarded, so this one starts as the presenter does.
for (const stale of declarations.filter(
  (d) => d.obligationId === obligation.id && d.status === 'draft',
)) {
  ok(
    await api.declarations.DELETE('/v1/declarations/{declarationId}', {
      params: { path: { declarationId: stale.id } },
    }),
    'discard an earlier draft',
  );
}
const draft = ok(
  await api.declarations.POST('/v1/obligations/{id}/declaration', {
    params: { path: { id: obligation.id } },
  }),
  'start the current declaration',
);
const declarationId = draft.id;
const path = { declarationId };
const version = async () =>
  String(
    ok(
      await api.declarations.GET('/v1/declarations/{declarationId}', { params: { path } }),
      'draft',
    ).draftVersion,
  );

// Bio and household as she would type them; the registries are asked for the officer.
const bio = ok(
  await api.declarations.GET('/v1/declarations/{declarationId}/sections/{sectionKey}', {
    params: { path: { declarationId, sectionKey: 'bio' } },
  }),
  'bio',
).contents;
for (const [sectionKey, contents] of [
  [
    'bio',
    {
      ...bio,
      birth: { date: row.dateOfBirth, place: row.placeOfBirth },
      maritalStatus: 'married',
      maritalStatusChange: { changed: false },
      address: { postal: 'P.O. Box 47715-00100, Nairobi', physical: 'Ruiru, Kiambu' },
      employment: { nature: 'permanent', ...(bio.employment as Record<string, unknown>) },
    },
  ],
  ['household', { spouses: { none: true, items: [] }, children: { none: true, items: [] } }],
] as const) {
  ok(
    await api.declarations.PUT('/v1/declarations/{declarationId}/sections/{sectionKey}', {
      params: { path: { declarationId, sectionKey }, header: { 'If-Match': await version() } },
      body: contents,
    }),
    `save ${sectionKey}`,
  );
}

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

// Accept the Fielder, the parcel and the salary hint; each becomes an item to attach a file to.
const accept = async (
  suggestionId: string,
  fields: Record<string, unknown>,
  applyToItemId: string | null,
) =>
  ok(
    await api.declarations.POST(
      '/v1/declarations/{declarationId}/suggestions/{suggestionId}/accept',
      {
        params: { path: { declarationId, suggestionId }, header: { 'If-Match': await version() } },
        body: { fields, applyToItemId, overwrite: true },
      },
    ),
    `accept ${suggestionId}`,
  );
const items: Record<string, string> = {};
for (const [key, suggestion] of [
  ['vehicle', offered('KCX 214J')],
  ['land', offered('KIAMBU/RUIRU')],
  ['salary', registry.find((s) => s.itemType === 'income-hint')],
] as const) {
  if (!suggestion) continue;
  items[key] = (await accept(suggestion.id, suggestion.fields, null)).itemId;
}

// Read each sample file into its item.
const files = [
  { key: 'salary', file: 'payslip-kemsa-june-2026.pdf', type: 'application/pdf', kind: 'payslip' },
  { key: 'vehicle', file: 'logbook-fielder-kcx-214j.jpg', type: 'image/jpeg', kind: 'logbook' },
  { key: 'land', file: 'title-deed-kiambu-ruiru.pdf', type: 'application/pdf', kind: 'title-deed' },
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
    await accept(suggestion.id, suggestion.fields, itemId);
  }
}

// The rest as she would leave it, then submit with a fresh sign-in.
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
        ...withValue(a, 'value', 1_000_000),
      })),
      liabilitiesNil: true,
      liabilities: [],
    },
  }),
  'save the statement',
);
ok(
  await api.declarations.PUT('/v1/declarations/{declarationId}/sections/{sectionKey}', {
    params: {
      path: { declarationId, sectionKey: 'other' },
      header: { 'If-Match': await version() },
    },
    body: {
      materialChanges: [],
      registrableInterests: {
        directorships: [],
        memberships: [],
        dualCitizenship: { holds: false, pendingApplication: false },
        pendingCases: [],
      },
      freeText: '',
    },
  }),
  'save other information',
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
