import { describe, expect, it } from 'vitest';

import type { reviewFlags } from '../../src/cases/schema.js';
import { copilotInputs } from '../../src/copilot/copilot-inputs.js';
import {
  asset,
  declaration,
  income,
  liability,
  revalued,
  statement,
} from '../fixtures/declarations.js';

/** The copilot's task inputs (spec 07c): what the gateway is asked to summarise and explain. */
describe('copilotInputs', () => {
  const land = asset({ description: 'Plot in Kisumu', value: { kesCents: 1_000_000_000 } });
  const car = asset({ type: 'vehicle', description: 'Toyota Prado' });
  const salary = income();
  const loan = liability();
  const previous = declaration([statement('officer', { income: [salary], assets: [land, car] })]);
  const raised = revalued(land, 1_410_000_000);
  const current = declaration([
    statement('officer', { income: [salary], assets: [raised], liabilities: [loan] }),
  ]);

  const flag = (itemIds: (string | null)[]): typeof reviewFlags.$inferSelect => ({
    id: '0199b000-0000-7000-8000-0000000000f1',
    tenant: 'psc',
    caseId: '0199b000-0000-7000-8000-0000000000c1',
    versionId: '0199b000-0000-7000-8000-0000000000d1',
    ruleId: 'value-change-25',
    severity: 'medium',
    title: 'Value changed by 25% or more',
    indicator: 'The declared value changed by 25% or more.',
    evidence: { changePercent: 41 },
    itemRefs: itemIds.map((itemId) => ({
      personKey: 'officer',
      itemId,
      sectionKey: 'statement:officer',
    })),
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    recomputed: false,
    createdAt: new Date('2028-01-20T08:00:00.000Z'),
  });

  it('lists what changed since the previous version: value changes, acquisitions and disposals', () => {
    const { summarize } = copilotInputs({ current, previous, flags: [], registryStatuses: [] });

    expect(summarize).toMatchObject({
      kind: 'summarize-declaration',
      document: current,
      previousDocument: previous,
      flags: [],
      registryStatuses: [],
      language: 'en',
    });
    // The unchanged salary is left out.
    expect(summarize.changes).toEqual([
      {
        kind: 'value-changed',
        personKey: 'officer',
        sectionKey: 'statement:officer',
        itemId: raised.id,
        percent: 41,
      },
      {
        kind: 'acquired',
        personKey: 'officer',
        sectionKey: 'statement:officer',
        itemId: loan.id,
        percent: null,
      },
      {
        kind: 'disposed',
        personKey: 'officer',
        sectionKey: 'statement:officer',
        itemId: car.id,
        percent: null,
      },
    ]);
  });

  it('has no changes and no explanations for a first declaration without flags', () => {
    const inputs = copilotInputs({ current, previous: null, flags: [], registryStatuses: [] });
    expect(inputs.summarize).toMatchObject({ previousDocument: null, changes: [] });
    expect(inputs.explain).toBeNull();
  });

  it('explains the flags with the context of the items they refer to, from either version', () => {
    const flagged = flag([raised.id, car.id, raised.id, null]);
    const { summarize, explain } = copilotInputs({
      current,
      previous,
      flags: [flagged],
      registryStatuses: [{ system: 'ardhisasa', status: 'matched' }],
    });

    const flagInput = {
      id: flagged.id,
      ruleId: 'value-change-25',
      severity: 'medium',
      title: 'Value changed by 25% or more',
      indicator: 'The declared value changed by 25% or more.',
      evidence: { changePercent: 41 },
      itemRefs: [raised.id, car.id, raised.id, null].map((itemId) => ({
        personKey: 'officer',
        itemId,
        sectionKey: 'statement:officer',
        fieldPath: null,
      })),
    };
    expect(summarize.flags).toEqual([flagInput]);
    expect(summarize.registryStatuses).toEqual([{ system: 'ardhisasa', status: 'matched' }]);
    expect(explain).toEqual({
      kind: 'explain-flags',
      flags: [flagInput],
      itemContext: [
        {
          ref: {
            sectionKey: 'statement:officer',
            personKey: 'officer',
            itemId: raised.id,
            fieldPath: null,
          },
          context: {
            version: 'current',
            category: 'assets',
            type: 'land',
            description: 'Plot in Kisumu',
            valueKesCents: 1_410_000_000,
            change: raised.change,
          },
        },
        {
          ref: {
            sectionKey: 'statement:officer',
            personKey: 'officer',
            itemId: car.id,
            fieldPath: null,
          },
          context: {
            version: 'previous',
            category: 'assets',
            type: 'vehicle',
            description: 'Toyota Prado',
            valueKesCents: car.value.kesCents,
            change: car.change,
          },
        },
      ],
      language: 'en',
    });
  });
});
