import { describe, expect, it } from 'vitest';

import type { reviewFlags } from '../../src/cases/schema.js';
import {
  type CopilotDraftInput,
  draftClarificationInput,
  draftOfOutput,
  InvalidDraftSelection,
} from '../../src/copilot/draft-input.js';
import { asset, declaration, income, SPOUSE, statement } from '../fixtures/declarations.js';

/** The `draft-clarification` input for a reviewer's selection, and its output (spec 07c S12). */
describe('draftClarificationInput', () => {
  const land = asset({ description: 'Plot in Kisumu', value: { kesCents: 1_000_000_000 } });
  const car = asset({ type: 'vehicle', description: 'Toyota Prado' });
  const salary = income();
  const document = declaration([
    statement('officer', { income: [salary], assets: [land, car] }),
    statement(SPOUSE, {}),
  ]);
  const disposedId = '0199b000-0000-7000-8000-0000000000e9';

  const flag = (
    id: string,
    itemIds: (string | null)[],
    personKey = 'officer',
  ): typeof reviewFlags.$inferSelect => ({
    id,
    tenant: 'psc',
    caseId: '0199b000-0000-7000-8000-0000000000c1',
    versionId: '0199b000-0000-7000-8000-0000000000d1',
    ruleId: 'value-change-25',
    severity: 'medium',
    title: 'Value changed by 25% or more',
    indicator: 'The declared value changed by 25% or more.',
    evidence: { changePercent: 41 },
    itemRefs: itemIds.map((itemId) => ({
      personKey,
      itemId,
      sectionKey: `statement:${personKey}`,
    })),
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    recomputed: false,
    closedReason: null,
    createdAt: new Date('2028-01-20T08:00:00.000Z'),
  });
  const landFlag = flag('0199b000-0000-7000-8000-0000000000f1', [land.id]);
  const disposalFlag = flag('0199b000-0000-7000-8000-0000000000f2', [disposedId]);
  const flags = [landFlag, disposalFlag];

  const build = (selection: Partial<CopilotDraftInput>) =>
    draftClarificationInput({
      document,
      flags,
      selection: { flagIds: [], itemRefs: [], language: 'sw', ...selection },
      commissionName: 'Public Service Commission',
    });

  const ref = (itemId: string | null, personKey = 'officer') => ({
    sectionKey: `statement:${personKey}`,
    personKey,
    itemId,
    fieldPath: null,
  });

  it('builds one selection per item with its context, its selected flag and the requirement, in the requested language', () => {
    const input = build({
      flagIds: [landFlag.id],
      itemRefs: [
        {
          personKey: 'officer',
          itemId: land.id,
          sectionKey: null,
          requirement: 'explain-discrepancy',
        },
        { personKey: null, itemId: car.id, sectionKey: null, requirement: null },
      ],
    });

    expect(input).toEqual({
      kind: 'draft-clarification',
      commissionName: 'Public Service Commission',
      language: 'sw',
      selections: [
        {
          ref: ref(land.id),
          flag: expect.objectContaining({ id: landFlag.id, ruleId: 'value-change-25' }) as object,
          itemContext: {
            version: 'current',
            category: 'assets',
            type: land.type,
            description: 'Plot in Kisumu',
            valueKesCents: 1_000_000_000,
            change: land.change,
          },
          requirement: 'explain-discrepancy',
        },
        {
          ref: ref(car.id),
          flag: null,
          itemContext: expect.objectContaining({ description: 'Toyota Prado' }) as object,
          requirement: null,
        },
      ],
    });
  });

  it('adds the items of a selected flag no selected item covers; one the version no longer holds goes at its statement', () => {
    const input = build({ flagIds: [landFlag.id, disposalFlag.id] });

    expect(input.selections).toEqual([
      expect.objectContaining({ ref: ref(land.id), requirement: null }),
      {
        ref: ref(null),
        flag: expect.objectContaining({ id: disposalFlag.id }) as object,
        itemContext: { section: 'statement:officer', personKey: 'officer' },
        requirement: null,
      },
    ]);
  });

  it('gives each selected flag about the same statement its own selection (#702)', () => {
    type FlagRow = typeof reviewFlags.$inferSelect;
    const statementFlag = (
      id: string,
      ruleId: FlagRow['ruleId'],
      evidence: FlagRow['evidence'],
    ): FlagRow => ({ ...flag(id, [null]), ruleId, evidence });
    const vehicle = statementFlag(
      '0199b000-0000-7000-8000-0000000000f3',
      'registry-vehicle-undeclared',
      {
        registrationNumber: 'KDK 482M',
      },
    );
    const parcel = statementFlag(
      '0199b000-0000-7000-8000-0000000000f4',
      'registry-parcel-undeclared',
      {
        parcelNumber: 'KAJIADO/KITENGELA/59821',
      },
    );
    const input = draftClarificationInput({
      document,
      flags: [vehicle, parcel],
      selection: { flagIds: [vehicle.id, parcel.id], itemRefs: [], language: 'en' },
      commissionName: 'Public Service Commission',
    });

    expect(input.selections).toEqual([
      expect.objectContaining({
        ref: ref(null),
        flag: expect.objectContaining({ evidence: { registrationNumber: 'KDK 482M' } }) as object,
      }),
      expect.objectContaining({
        ref: ref(null),
        flag: expect.objectContaining({
          evidence: { parcelNumber: 'KAJIADO/KITENGELA/59821' },
        }) as object,
      }),
    ]);
  });

  it('takes a whole section, and a person by their statement', () => {
    const input = build({
      itemRefs: [
        { personKey: null, itemId: null, sectionKey: 'household', requirement: 'provide-omitted' },
        { personKey: SPOUSE, itemId: null, sectionKey: null, requirement: null },
      ],
    });

    expect(input.selections.map((selection) => selection.ref)).toEqual([
      { sectionKey: 'household', personKey: null, itemId: null, fieldPath: null },
      ref(null, SPOUSE),
    ]);
  });

  it('refuses a selection that is not on the case', () => {
    const other = '0199b000-0000-7000-8000-0000000000ff';
    const refused: Partial<CopilotDraftInput>[] = [
      { flagIds: [other] },
      { itemRefs: [{ personKey: null, itemId: other, sectionKey: null, requirement: null }] },
      // The item is the officer's, not the spouse's.
      { itemRefs: [{ personKey: SPOUSE, itemId: land.id, sectionKey: null, requirement: null }] },
      {
        itemRefs: [
          { personKey: null, itemId: null, sectionKey: 'statement:child:x', requirement: null },
        ],
      },
      { itemRefs: [{ personKey: null, itemId: null, sectionKey: null, requirement: null }] },
      {},
    ];
    for (const selection of refused) {
      expect(() => build(selection), JSON.stringify(selection)).toThrow(InvalidDraftSelection);
    }
  });
});

describe('draftOfOutput', () => {
  it('maps the drafted items to the clarification item shape', () => {
    const label = { aiAssisted: true, task: 'draft-clarification' };
    expect(
      draftOfOutput({
        label,
        opening: 'Tafadhali eleza.',
        items: [
          {
            ref: {
              sectionKey: 'statement:officer',
              personKey: 'officer',
              itemId: null,
              fieldPath: null,
            },
            requirement: 'provide-omitted',
            text: 'Taja shamba.',
          },
        ],
      }),
    ).toEqual({
      label,
      opening: 'Tafadhali eleza.',
      items: [
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: null,
          requirement: 'provide-omitted',
          text: 'Taja shamba.',
        },
      ],
    });
    expect(draftOfOutput({ label, opening: null, items: [{ text: '' }] })).toBeNull();
  });
});
