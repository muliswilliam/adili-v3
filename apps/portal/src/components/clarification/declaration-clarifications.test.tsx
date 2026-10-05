// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MyClarificationsLoad } from '../../server/clarifications';
import { MOCK_CLARIFICATION_IDS, mockClarification } from '../../server/review/mock.server';
import { DeclarationClarificationsSection } from './declaration-clarifications';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);

const NOW = '2026-09-28T09:00:00.000Z';

function fixture(id: string) {
  const clarification = mockClarification(id);
  if (!clarification) throw new Error(`no fixture ${id}`);
  return clarification;
}

async function renderSection(load: MyClarificationsLoad, references: string[]) {
  const clarifications = Promise.resolve(load);
  await act(async () => {
    render(
      <DeclarationClarificationsSection clarifications={clarifications} references={references} />,
    );
    await clarifications;
  });
}

describe("the declaration's clarifications (spec 07a FE-5, story 31)", () => {
  const open = fixture(MOCK_CLARIFICATION_IDS.open);
  const resolved = fixture(MOCK_CLARIFICATION_IDS.resolved);
  const elsewhere = {
    ...resolved,
    id: 'c1a70000-0000-4000-8000-0000000000ff',
    declarationReference: 'DCB-PSC-2027-0000001-A',
  };

  it("lists this declaration's clarifications with their status, each a link to respond", async () => {
    await renderSection({ status: 'ok', clarifications: [resolved, elsewhere, open], now: NOW }, [
      open.declarationReference,
      resolved.declarationReference,
    ]);

    const card = screen.getByRole('region', { name: 'Clarifications on this declaration' });
    const links = within(card)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      '/clarifications',
      `/clarifications/${open.id}`,
      `/clarifications/${resolved.id}`,
    ]);
    expect(within(card).getByText('Resolved')).toBeTruthy();
    expect(within(card).queryByText(/DCB-PSC/)).toBeNull();
  });

  it('shows nothing when none concerns this declaration', async () => {
    await renderSection({ status: 'ok', clarifications: [elsewhere], now: NOW }, [
      open.declarationReference,
    ]);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows nothing when the list could not load', async () => {
    await renderSection({ status: 'unavailable', now: NOW }, [open.declarationReference]);
    expect(screen.queryByRole('region')).toBeNull();
  });
});
