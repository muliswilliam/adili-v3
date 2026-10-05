// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AuditChainPage, AuditChainVerification } from '../../server/audit/types';
import type { ServiceResult } from '../../server/service-call';
import { AuditChainsView } from './audit-chains-view';

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock('../../server/audit-trail', () => ({ checkAuditChain: vi.fn() }));

const chains: ServiceResult<AuditChainPage> = {
  ok: true,
  data: {
    items: [
      {
        tenant: 'psc',
        chainDay: '2026-10-05',
        events: 12,
        headHash: 'a'.repeat(64),
        anchor: null,
      },
      {
        tenant: 'psc',
        chainDay: '2026-10-04',
        events: 40,
        headHash: 'b'.repeat(64),
        anchor: {
          merkleRoot: 'c'.repeat(64),
          anchoredAt: '2026-10-05T00:30:04Z',
          objectKey: 'anchors/psc/2026-10-04.json',
        },
      },
    ],
  },
};

const verification = (
  overrides: Partial<AuditChainVerification>,
): ServiceResult<AuditChainVerification> => ({
  ok: true,
  data: {
    tenant: 'psc',
    chainDay: '2026-10-04',
    events: 40,
    status: 'intact',
    problems: [],
    anchor: { status: 'matches', anchoredAt: '2026-10-05T00:30:04Z' },
    merkleRoot: 'c'.repeat(64),
    ...overrides,
  },
});

describe('AuditChainsView', () => {
  it('shows each chain with its anchor', () => {
    render(<AuditChainsView result={chains} verify={vi.fn()} />);
    const [, today, yesterday] = within(screen.getByRole('table')).getAllByRole('row');
    if (!today || !yesterday) throw new Error('Expected a row per chain');
    expect(within(today).getByText('Not anchored yet')).toBeTruthy();
    expect(within(yesterday).getByText(/^Anchored /)).toBeTruthy();
  });

  it('verifies a chain on the spot: intact, with its anchor matching', async () => {
    const verify = vi.fn(() => Promise.resolve(verification({})));
    render(<AuditChainsView result={chains} verify={verify} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify the psc chain of 2026-10-04' }));
    expect(await screen.findByText('Intact')).toBeTruthy();
    expect(screen.getByText('40 events recomputed, anchor matches.')).toBeTruthy();
    expect(verify).toHaveBeenCalledWith('psc', '2026-10-04');
  });

  it('names what was tampered with', async () => {
    const verify = vi.fn(() =>
      Promise.resolve(
        verification({
          status: 'tampered',
          problems: [
            { kind: 'hash-mismatch', seq: 7 },
            { kind: 'anchor-mismatch', seq: null },
          ],
          anchor: { status: 'mismatch', anchoredAt: '2026-10-05T00:30:04Z' },
        }),
      ),
    );
    render(<AuditChainsView result={chains} verify={verify} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify the psc chain of 2026-10-04' }));
    expect(await screen.findByText('Tampered')).toBeTruthy();
    expect(screen.getByText('Event 7: hash does not match its content')).toBeTruthy();
    expect(
      screen.getByText('Anchor does not match the events, or its signature fails'),
    ).toBeTruthy();
  });

  it('says when a chain could not be verified', async () => {
    const verify = vi.fn(() =>
      Promise.resolve({ ok: false, error: { kind: 'unavailable', detail: null } } as const),
    );
    render(<AuditChainsView result={chains} verify={verify} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify the psc chain of 2026-10-05' }));
    expect(
      await screen.findByText('The chain could not be verified. Try again in a moment.'),
    ).toBeTruthy();
  });
});
