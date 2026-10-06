// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CorpusPassage } from '../../server/declarations/client';
import { CorpusView, type ImportCorpus, type LoadPassage } from './corpus-view';
import { type HelpSession, HelpSessionContext } from './scope';
import { nth } from './test-router';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('./test-router')).TestLink,
  useRouter: () => ({ invalidate }),
}));

const TODAY = '2026-10-03';
const PLATFORM = { scope: { kind: 'platform' }, readOnly: false } as const;

const passage = (n: number, patch: Partial<CorpusPassage> = {}): CorpusPassage => ({
  id: `0199c0de-c000-7000-8000-${String(n).padStart(12, '0')}`,
  source: 'regs',
  citation: `Regs r.${String(n)}`,
  title: `Regulation ${String(n)}`,
  tags: [],
  effectiveFrom: '2026-03-02',
  effectiveTo: null,
  version: 'c3f91a2e',
  ...patch,
});

const MATERIAL = passage(1, {
  source: 'act',
  citation: 'Act s.31(4)',
  title: 'Meaning of material change',
  tags: ['statement', 'material-change'],
});
const OLD = passage(2, {
  source: 'act',
  citation: 'Act s.31(4)',
  title: 'Meaning of material change',
  effectiveFrom: '2025-10-15',
  effectiveTo: '2026-03-02',
  version: 'a17b04d9',
});
const PASSAGES = [OLD, MATERIAL, ...Array.from({ length: 11 }, (_, index) => passage(index + 3))];

function renderView(props: Partial<ComponentProps<typeof CorpusView>> = {}) {
  const loadPassage = vi.fn<LoadPassage>((id) =>
    Promise.resolve({
      ok: true,
      data: {
        ...(PASSAGES.find((each) => each.id === id) ?? MATERIAL),
        textEn: '"material change" means (a) at least twenty-five percent increase...',
        textSw: '"mabadiliko makubwa" maana yake ni...',
      },
    }),
  );
  const importCorpus = vi.fn<ImportCorpus>();
  const onSearchChange = vi.fn();
  const session: HelpSession = {
    justPublished: null,
    setJustPublished: vi.fn(),
    searchAsDeclarants: vi.fn(),
    onUnauthenticated: vi.fn(),
    scopes: [],
    chooseScope: vi.fn(),
  };
  render(
    <ToastProvider>
      <TooltipProvider>
        <HelpSessionContext value={session}>
          <CorpusView
            workspace={PLATFORM}
            result={{ ok: true, data: PASSAGES }}
            search={{}}
            onSearchChange={onSearchChange}
            today={TODAY}
            loadPassage={loadPassage}
            importCorpus={importCorpus}
            onUnauthenticated={vi.fn()}
            {...props}
          />
        </HelpSessionContext>
      </TooltipProvider>
    </ToastProvider>,
  );
  return { loadPassage, importCorpus, onSearchChange };
}

describe('legal corpus (spec 11 FE-4, S9)', () => {
  it('lists the wordings in force with citation, source, period and version, read only', () => {
    renderView();
    expect(screen.getByText('Version c3f91a2e · 12 passages in force')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About the corpus' })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Legal corpus passages' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    const first = nth(rows, 0);
    expect(within(first).getByText('Act s.31(4)')).toBeTruthy();
    expect(within(first).getByText('Act')).toBeTruthy();
    expect(within(first).getByText('From 2 Mar 2026')).toBeTruthy();
    expect(within(first).getByText('c3f91a2e')).toBeTruthy();
    expect(within(table).queryByText('Superseded')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New article' })).toBeNull();
  });

  it('shows superseded wordings when asked, marked so', () => {
    const { onSearchChange } = renderView();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show superseded' }));
    expect(onSearchChange).toHaveBeenCalledWith({ old: true, page: undefined });
  });

  it('marks a superseded wording with its end date', () => {
    renderView({ search: { old: true } });
    const table = screen.getByRole('table', { name: 'Legal corpus passages' });
    expect(within(table).getByText('15 Oct 2025 - 2 Mar 2026')).toBeTruthy();
    expect(within(table).getByText('Superseded')).toBeTruthy();
  });

  it('opens a wording with its English and Kiswahili text', async () => {
    const { loadPassage } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Meaning of material change' }));
    const drawer = await screen.findByRole('dialog', { name: 'Meaning of material change' });
    expect(loadPassage).toHaveBeenCalledWith(MATERIAL.id);
    expect(await within(drawer).findByText(/mabadiliko makubwa/)).toBeTruthy();
    expect(within(drawer).getByText(/twenty-five percent/)).toBeTruthy();
    expect(within(drawer).getByText('Material change')).toBeTruthy();
    expect(within(drawer).getByText('Read only. Imported from the repository.')).toBeTruthy();
  });

  it('says when no passage matches, and when the corpus could not be loaded', () => {
    renderView({ search: { q: 'helicopter' } });
    expect(screen.getByText('No passages match')).toBeTruthy();
    renderView({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });
    expect(screen.getByText('The legal corpus could not be loaded.')).toBeTruthy();
  });

  it('re-imports after confirming, and says when nothing changed', async () => {
    const { importCorpus } = renderView();
    importCorpus.mockResolvedValue({
      ok: true,
      data: {
        version: 'c3f91a2e',
        skipped: true,
        inserted: 0,
        updated: 0,
        removed: 0,
        unchanged: 12,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Re-import' }));
    const dialog = await screen.findByRole('dialog', { name: 'Re-import the legal corpus?' });
    expect(within(dialog).getByText('c3f91a2e')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-import' }));
    expect(await screen.findByText('The corpus is up to date. Nothing changed.')).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('reloads the corpus after an import that changed it', async () => {
    const { importCorpus } = renderView();
    importCorpus.mockResolvedValue({
      ok: true,
      data: {
        version: 'd00dfeed',
        skipped: false,
        inserted: 1,
        updated: 3,
        removed: 1,
        unchanged: 8,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Re-import' }));
    const dialog = await screen.findByRole('dialog', { name: 'Re-import the legal corpus?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-import' }));
    expect(await screen.findByText('Imported: 1 new, 3 changed, 1 superseded.')).toBeTruthy();
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
  });
});
