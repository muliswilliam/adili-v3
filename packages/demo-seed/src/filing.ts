import { randomUUID } from 'node:crypto';

import type { Statement } from '@adili/forms';

import { type Apis, ok } from './clients/api.js';
import type { SeedContext } from './context.js';
import {
  type Holdings,
  householdSection,
  itemId,
  nilStatement,
  officerStatement,
  otherInformation,
} from './data/declaration.js';

/** Who files: the demo account and what their bio needs that no registry pre-fills. */
export interface Declarant {
  demoKey: string;
  birth: { date: string; place: string };
}

/** An obligation of the signed-in declarant, as `GET /v1/me/obligations` lists it. */
export interface MyObligation {
  id: string;
  type: 'initial' | 'biennial' | 'final';
  cycleKey: string;
  statementDate: string;
  dueDate: string;
  status: string;
  commission: { slug: string };
}

export interface MyDeclaration {
  id: string;
  obligationId: string;
  status: 'draft' | 'amending' | 'submitted' | 'discarded';
  currentVersion: number | null;
}

/** The declarant's obligations and declarations, read once per filing round. */
export async function declarantState(
  api: Apis,
): Promise<{ obligations: MyObligation[]; declarations: MyDeclaration[] }> {
  const obligations = ok(await api.declarations.GET('/v1/me/obligations'), 'my obligations');
  const declarations = ok(await api.declarations.GET('/v1/me/declarations'), 'my declarations');
  return {
    obligations: obligations.groups.flatMap((group) => group.obligations),
    declarations: declarations,
  };
}

/**
 * Fills a draft (or an amendment in progress) section by section as the portal saves it, then
 * submits it with a fresh step-up sign-in. `holdings` is what the officer declares, `previous` what
 * their previous declaration on Adili held (null when it has none).
 */
async function fillAndSubmit(
  context: SeedContext,
  declarant: Declarant,
  declarationId: string,
  holdings: Holdings,
  previous: Holdings | undefined,
): Promise<void> {
  const { demoKey } = declarant;
  const api = await context.as(demoKey);
  const path = { declarationId };
  const draft = ok(
    await api.declarations.GET('/v1/declarations/{declarationId}', { params: { path } }),
    'read draft',
  );
  const followsEarlier = draft.type !== 'initial';
  let version = draft.draftVersion;
  const save = async (sectionKey: string, contents: Record<string, unknown>) => {
    const saved = ok(
      await api.declarations.PUT('/v1/declarations/{declarationId}/sections/{sectionKey}', {
        params: {
          path: { declarationId, sectionKey: sectionKey as never },
          header: { 'If-Match': String(version) },
        },
        body: contents,
      }),
      `save ${sectionKey} of ${declarationId}`,
    );
    version = saved.draftVersion;
  };

  const bio = ok(
    await api.declarations.GET('/v1/declarations/{declarationId}/sections/{sectionKey}', {
      params: { path: { declarationId, sectionKey: 'bio' } },
    }),
    'read bio',
  ).contents as Record<string, unknown> & {
    name?: Statement['personName'];
    employment?: Record<string, unknown>;
  };
  const married = (holdings.household?.spouses.length ?? 0) > 0;
  const wasMarried = (previous?.household?.spouses.length ?? 0) > 0;
  await save('bio', {
    ...bio,
    birth: declarant.birth,
    maritalStatus: married ? 'married' : 'single',
    ...(followsEarlier && {
      maritalStatusChange:
        previous && married !== wasMarried
          ? { changed: true, explanation: 'Marital status changed since the last declaration.' }
          : { changed: false },
    }),
    address: { postal: 'P.O. Box 30095-00100, Nairobi', physical: 'Nairobi' },
    employment: { nature: 'permanent', ...bio.employment },
  });
  await save('household', householdSection(holdings.household, draft.statementDate));
  const frame = {
    statementDate: draft.statementDate,
    incomePeriod: { from: draft.incomePeriod.from, to: draft.incomePeriod.to },
  };
  const statement = (contents: Statement) => contents as unknown as Record<string, unknown>;
  await save(
    'statement:officer',
    statement(
      officerStatement(
        { ...frame, personName: bio.name ?? { surname: 'Officer', firstName: 'Demo' } },
        holdings,
        previous,
        followsEarlier,
      ),
    ),
  );
  for (const spouse of holdings.household?.spouses ?? []) {
    const personKey = `spouse:${itemId('spouse', spouse.nationalId)}`;
    const before = previous?.household?.spouses.find((s) => s.nationalId === spouse.nationalId);
    await save(
      `statement:${personKey}`,
      statement(
        officerStatement(
          { ...frame, personName: spouse.name, personKey },
          spouse.holdings,
          before?.holdings,
          followsEarlier,
        ),
      ),
    );
  }
  const included = householdSection(holdings.household, draft.statementDate).children.items.filter(
    (child) => child.includedAtStatementDate,
  );
  for (const child of included) {
    const personKey = `child:${child.id}`;
    await save(`statement:${personKey}`, statement(nilStatement(frame, personKey, child.name)));
  }
  await save('other', otherInformation(holdings, previous, followsEarlier));

  const fresh = await context.as(demoKey, { fresh: true });
  ok(
    await fresh.declarations.POST('/v1/declarations/{declarationId}/submit', {
      params: { path, header: { 'Idempotency-Key': randomUUID() } },
    }),
    `submit ${declarationId}`,
  );
}

/**
 * Files the obligation's declaration unless it is filed already; with `amendTo`, amends the filed
 * declaration to version 2 with those holdings unless it is at version 2 already. Returns how many
 * submissions it made.
 */
export async function fileObligation(
  context: SeedContext,
  declarant: Declarant,
  obligation: MyObligation,
  existing: MyDeclaration | undefined,
  holdings: Holdings,
  previous: Holdings | undefined,
  amendTo?: Holdings,
): Promise<number> {
  const { demoKey } = declarant;
  let submitted = 0;
  let declaration = existing;
  if (declaration?.status !== 'submitted' && declaration?.status !== 'amending') {
    const api = await context.as(demoKey);
    const draft = ok(
      await api.declarations.POST('/v1/obligations/{id}/declaration', {
        params: { path: { id: obligation.id } },
      }),
      `start ${obligation.cycleKey}`,
    );
    await fillAndSubmit(context, declarant, draft.id, holdings, previous);
    submitted++;
    declaration = {
      id: draft.id,
      obligationId: obligation.id,
      status: 'submitted',
      currentVersion: 1,
    };
  }
  if (amendTo && (declaration.currentVersion ?? 0) < 2) {
    if (declaration.status !== 'amending') {
      const api = await context.as(demoKey);
      ok(
        await api.declarations.POST('/v1/declarations/{declarationId}/amend', {
          params: { path: { declarationId: declaration.id } },
        }),
        `amend ${declaration.id}`,
      );
    }
    await fillAndSubmit(context, declarant, declaration.id, amendTo, previous);
    submitted++;
  }
  return submitted;
}
