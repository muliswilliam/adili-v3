// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LoadedSuggestion, LoadedSuggestionSet } from '../../server/declarations.server';
import { KraLine, kraLineText } from './kra-line';

function kraSet(
  suggestions: Partial<LoadedSuggestion>[],
  overrides: Partial<LoadedSuggestionSet> = {},
): LoadedSuggestionSet {
  return {
    id: 'kra-1',
    personKey: 'officer',
    source: 'kra',
    status: 'ready',
    requestedAt: '2026-09-26T07:30:00Z',
    readyAt: '2026-09-26T07:32:00Z',
    verificationResultId: null,
    aiJobId: null,
    suggestions: suggestions.map((each, index) => ({
      id: `k${String(index)}`,
      setId: 'kra-1',
      personKey: 'officer',
      sectionKey: 'bio',
      itemType: 'bio-tax',
      fields: { kraPin: 'A005231876K', complianceStatus: 'compliant' },
      sourceRef: {},
      confidence: null,
      matchItemId: null,
      status: 'new',
      acceptedItemId: null,
      ...each,
    })),
    ...overrides,
  };
}

describe('KraLine', () => {
  it("shows the officer's masked KRA PIN, compliance and when it was checked", () => {
    render(<KraLine sets={[kraSet([{}])]} />);

    expect(
      screen.getByText('KRA PIN A00•••••76K · Compliance: Compliant (checked 26 Sep 2026)'),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('uses the newest KRA answer and leaves out a dismissed or missing PIN', () => {
    const older = kraSet([{ fields: { kraPin: 'A000000001Z' } }], {
      id: 'kra-0',
      requestedAt: '2026-09-01T07:30:00Z',
    });
    expect(kraLineText([older, kraSet([{ fields: { kraPin: 'A005231876K' } }])])).toBe(
      'KRA PIN A00•••••76K (checked 26 Sep 2026)',
    );
    expect(kraLineText([kraSet([{ status: 'dismissed' }])])).toBe(null);
    expect(kraLineText([kraSet([{ fields: {} }])])).toBe(null);
    expect(kraLineText([])).toBe(null);
  });
});
