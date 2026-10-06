// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ChangeRow } from '../../declaration/comparison';
import type { Draft, Statement } from '../../declaration/contents';
import type { PreviousDeclaration } from '../../server/declarations.server';
import { CHANGES_COPY, ChangesTable, changeText, StatementChanges } from './changes-since-last';

/** A value change from `previousCents` to `currentCents`, material by the exact ratio. */
function valueRow(previousCents: number, currentCents: number): ChangeRow {
  return {
    kind: 'value',
    category: 'assets',
    type: 'land',
    description: 'Plot in Kapsoya',
    itemId: 'a1',
    previousCents,
    currentCents,
    material: previousCents === 0 || Math.abs(currentCents - previousCents) / previousCents >= 0.25,
    markedAsChanged: false,
  };
}

/** An item no longer declared; paragraph 9 records it, does not, or is not known. */
const goneRow = (recordedInParagraph9?: boolean): ChangeRow => ({
  ...valueRow(50_000_00, 0),
  kind: 'gone',
  description: 'Toyota Probox',
  itemId: null,
  currentCents: null,
  material: true,
  ...(recordedInParagraph9 !== undefined && { recordedInParagraph9 }),
});

describe('changeText', () => {
  it('gives the change to one decimal', () => {
    expect(changeText(valueRow(100_000_00, 124_600_00))).toBe('Up 24.6%');
    expect(changeText(valueRow(180_000_000, 240_000_000))).toBe('Up 33.3%');
  });

  it('shows a change of exactly 25% as 25.0%', () => {
    expect(changeText(valueRow(100_000_00, 125_000_00))).toBe('Up 25.0%');
    expect(changeText(valueRow(100_000_00, 75_000_00))).toBe('Down 25.0%');
  });

  it('never shows a change under 25% as 25.0%, so the figure agrees with the material badge', () => {
    const row = valueRow(100_000_00, 124_960_00);
    expect(row.material).toBe(false);
    expect(changeText(row)).toBe('Up 24.9%');
  });

  it('shows a tiny change as under 0.1%, never as 0.0%', () => {
    expect(changeText(valueRow(100_000_00, 100_040_00))).toBe('Up <0.1%');
    expect(changeText(valueRow(100_000_00, 99_960_00))).toBe('Down <0.1%');
  });

  it('gives a decrease', () => {
    expect(changeText(valueRow(115_000_000, 100_000_000))).toBe('Down 13.0%');
  });

  it('words a change with no percentage', () => {
    expect(changeText(valueRow(0, 50_000_00))).toBe('Up from nothing');
    expect(changeText({ ...valueRow(0, 50_000_00), kind: 'new', previousCents: null })).toBe('New');
    expect(changeText(goneRow())).toBe('No longer declared');
  });
});

describe('CHANGES_COPY.threshold', () => {
  it('asks for a disposal to be recorded in paragraph 9, not marked, as the reviewer reads it', () => {
    expect(CHANGES_COPY.threshold).toBe(
      'A change of 25% or more in value, or anything acquired or disposed of, is a material change (Act s.31(4)). Mark a changed or new item as changed and explain it; record anything disposed of or paid off in paragraph 9.',
    );
  });
});

describe('ChangesTable', () => {
  const rowText = (rows: ChangeRow[]) => {
    render(<ChangesTable changes={{ rows, unchanged: 0 }} caption="Changes" />);
    return within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent);
  };

  it('notes a value change under 25% marked as changed, which the reviewer queries', () => {
    expect(
      rowText([
        { ...valueRow(100_000_00, 110_000_00), markedAsChanged: true },
        valueRow(100_000_00, 110_000_00),
        { ...valueRow(100_000_00, 150_000_00), markedAsChanged: true },
      ]),
    ).toEqual([
      expect.stringMatching(/Up 10\.0%Marked as changed, under 25%$/),
      expect.stringMatching(/Up 10\.0%$/),
      expect.stringMatching(/Up 50\.0%Material change$/),
    ]);
  });

  it('shows the under-25% marking as a note, not a warning', () => {
    rowText([{ ...valueRow(100_000_00, 110_000_00), markedAsChanged: true }]);

    expect(screen.getByText(CHANGES_COPY.markedUnderThreshold).className).toMatch(
      /text-muted-foreground/,
    );
  });

  it('warns of an item no longer declared that paragraph 9 does not record', () => {
    expect(rowText([goneRow(false), goneRow(true), goneRow()])).toEqual([
      expect.stringMatching(/No longer declaredMaterial changeNot recorded in paragraph 9$/),
      expect.stringMatching(/No longer declaredMaterial change$/),
      expect.stringMatching(/No longer declaredMaterial change$/),
    ]);
  });
});

describe('StatementChanges', () => {
  const previous: PreviousDeclaration = {
    declarationId: '0199a8f0-0000-7000-8000-000000000999',
    version: 1,
    reference: 'DCB-TSC-2025-0000001-B',
    type: 'biennial',
    statementDate: '2025-11-01',
    submittedAt: '2025-12-02T09:00:00Z',
    statements: [
      {
        personKey: 'spouse:mary',
        assets: [
          {
            id: 'p1',
            type: 'land',
            description: 'Plot in Nyeri',
            value: { kesCents: 100_000_00 },
            change: { changed: false },
          },
        ],
      },
    ],
  };

  it('compares the statement as the person it is shown for, whatever key it was saved with', () => {
    // Saved before its person was set: read alone, it would be the officer's.
    const statement: Draft<Statement> = {
      assets: [
        {
          id: 'c1',
          type: 'land',
          description: 'Plot in Nyeri',
          value: { kesCents: 200_000_00 },
          change: { changed: false },
        },
      ],
    };
    render(
      <StatementChanges
        load={{ status: 'ready', previous }}
        statement={statement}
        personKey="spouse:mary"
      />,
    );

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^Plot in Nyeri.*Up 100\.0%Material changeNot marked as changed$/),
    ]);
  });
});
