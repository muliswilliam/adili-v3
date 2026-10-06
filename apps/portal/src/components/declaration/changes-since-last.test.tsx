import { describe, expect, it } from 'vitest';

import type { ChangeRow } from '../../declaration/comparison';
import { changeText } from './changes-since-last';

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
    changePercent:
      previousCents === 0
        ? null
        : Math.round(((currentCents - previousCents) / previousCents) * 100),
    material: previousCents === 0 || Math.abs(currentCents - previousCents) / previousCents >= 0.25,
    markedAsChanged: false,
  };
}

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
    expect(changeText({ ...valueRow(50_000_00, 0), kind: 'gone', currentCents: null })).toBe(
      'No longer declared',
    );
  });
});
