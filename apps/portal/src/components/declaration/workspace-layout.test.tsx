// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeclaration, saveDeclarationSection } from '../../server/declarations';
import type { SaveOutcome } from '../../server/declarations.server';
import { DECLARATION_ID, renderWorkspace, sampleDeclaration } from './testing';
import { invalidate, navigate } from './testing-mocks';
import { useWorkspace } from './workspace';
import { CONFLICT_COPY, RELOADED_COPY } from './workspace-layout';
import { HEADER_COPY } from './workspace-header';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());

const saveMock = vi.mocked(saveDeclarationSection);
const getMock = vi.mocked(getDeclaration);

/** Stands in for a section screen: one button that edits the bio and saves at once. */
function Editor() {
  const { edit, flush } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => {
        edit('bio', { birth: { place: 'Nyeri' } });
        flush('bio');
      }}
    >
      Edit
    </button>
  );
}

function saved(completeness: 'complete' | 'incomplete' = 'complete'): SaveOutcome {
  return {
    status: 'saved',
    etag: '"2"',
    result: { key: 'bio', completeness, draftVersion: 2, issues: [], sectionsChanged: [] },
  };
}

async function edit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await Promise.resolve();
  });
}

function saveStatus() {
  return screen.getAllByRole('status').filter((node) => node.closest('[data-status]'));
}

beforeEach(() => {
  saveMock.mockReset();
  getMock.mockReset();
  navigate.mockReset();
  invalidate.mockClear();
});

describe('WorkspaceLayout', () => {
  it('heads every screen with the declaration, statement date and income period', () => {
    renderWorkspace(<Editor />, { step: 'bio' });

    expect(screen.getByText('Biennial declaration · Teachers Service Commission')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Your details' })).toBeTruthy();
    expect(screen.getByText('1 Nov 2027')).toBeTruthy();
    expect(screen.getByText('1 Nov 2025 to 1 Nov 2027')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'What is statement date?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'What is income?' })).toBeTruthy();
    expect(screen.getByText(HEADER_COPY.assumed)).toBeTruthy();
  });

  it('leaves out the assumed-period note when the start was declared', () => {
    renderWorkspace(<Editor />, {
      declaration: sampleDeclaration({
        incomePeriod: { from: '2025-11-01', to: '2027-11-01', fromSource: 'declared' },
      }),
    });

    expect(screen.queryByText(HEADER_COPY.assumed)).toBeNull();
  });

  it('marks the current section and every completeness in text', () => {
    renderWorkspace(<Editor />, { step: 'bio' });

    const nav = screen.getByRole('navigation', { name: 'Declaration sections' });
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain('Your details');
    expect(current?.textContent).toContain('Not started');
    expect(nav.textContent).toContain('Check and submit');
  });

  it('names the back and next buttons', () => {
    renderWorkspace(<Editor />, { step: 'bio' });

    expect(screen.getByRole('link', { name: 'Back: Overview' }).getAttribute('href')).toBe(
      `/declarations/${DECLARATION_ID}`,
    );
    expect(
      screen.getByRole('link', { name: 'Next: spouses and children' }).getAttribute('href'),
    ).toBe(`/declarations/${DECLARATION_ID}/household`);
  });

  it('opens a section from the navigation', () => {
    renderWorkspace(<Editor />, { step: 'bio' });

    const nav = screen.getByRole('navigation', { name: 'Declaration sections' });
    fireEvent.click(within(nav).getByRole('button', { name: /Financial statements/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/declarations/$id/statements/$personKey',
      params: { id: DECLARATION_ID, personKey: 'officer' },
    });
  });

  it('shows Saved, then Saving… while a save is in flight', async () => {
    saveMock.mockReturnValue(new Promise(() => undefined));
    renderWorkspace(<Editor />, { step: 'bio' });
    expect(saveStatus()[0]?.textContent).toBe('Saved');

    await edit();

    expect(saveStatus()[0]?.textContent).toBe('Saving…');
    expect(saveStatus()[0]?.getAttribute('aria-live')).toBe('polite');
    expect(saveMock).toHaveBeenCalledWith({
      data: {
        declarationId: DECLARATION_ID,
        sectionKey: 'bio',
        ifMatch: '"1"',
        contents: { birth: { place: 'Nyeri' } },
      },
    });
  });

  it('updates the section completeness after a save', async () => {
    saveMock.mockResolvedValue(saved('complete'));
    renderWorkspace(<Editor />, { step: 'bio' });

    await edit();

    await waitFor(() => {
      expect(saveStatus()[0]?.textContent).toBe('Saved');
    });
    const nav = screen.getByRole('navigation', { name: 'Declaration sections' });
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain('Complete');
  });

  it('says it is retrying when a save fails', async () => {
    saveMock.mockResolvedValue({ status: 'unavailable' });
    renderWorkspace(<Editor />, { step: 'bio' });

    await edit();

    await waitFor(() => {
      expect(saveStatus()[0]?.textContent).toBe('Could not save, retrying');
    });
  });

  it('says it could not save when the service refuses the section', async () => {
    saveMock.mockResolvedValue({ status: 'rejected', code: 'identity-locked-field' });
    renderWorkspace(<Editor />, { step: 'bio' });

    await edit();

    await waitFor(() => {
      expect(saveStatus()[0]?.textContent).toBe('Could not save');
    });
  });

  it('stops editing on 412 and reloads the latest saved version', async () => {
    saveMock.mockResolvedValue({ status: 'conflict' });
    getMock.mockResolvedValue({
      status: 'ok',
      declaration: sampleDeclaration({ draftVersion: 5 }),
      etag: '"5"',
    });
    renderWorkspace(<Editor />, { step: 'bio' });

    await edit();

    await waitFor(() => {
      expect(screen.getByText(CONFLICT_COPY)).toBeTruthy();
    });
    expect(saveStatus()[0]?.textContent).toBe('Edited elsewhere: reload to continue');
    expect(saveStatus()[0]?.getAttribute('aria-live')).toBe('assertive');
    expect(screen.getByRole('button', { name: 'Edit' }).matches(':disabled')).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText(CONFLICT_COPY)).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByText(RELOADED_COPY)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' }).matches(':disabled')).toBe(false);

    saveMock.mockResolvedValue(saved());
    await edit();
    expect(saveMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ ifMatch: '"5"' }) as unknown,
    });
  });
});
