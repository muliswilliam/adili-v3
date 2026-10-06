// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HelpArticle } from '../../server/declarations/client';
import type { HelpResult } from '../../server/help.server';
import { ArticleEditor, type SaveArticle } from './article-editor';
import { type HelpSession, HelpSessionContext } from './scope';

const router = vi.hoisted(() => ({
  blocker: { status: 'idle', proceed: vi.fn(), reset: vi.fn() },
  shouldBlock: null as null | (() => boolean),
}));

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('./test-router')).TestLink,
  useBlocker: (options: { shouldBlockFn: () => boolean }) => {
    router.shouldBlock = options.shouldBlockFn;
    return router.blocker;
  },
}));

const TODAY = '2026-10-03';
const ADMIN = { scope: { kind: 'commission', slug: 'psc' }, readOnly: false } as const;

const FILE_NUMBERS: HelpArticle = {
  id: '0199c0de-a000-7000-8000-000000000001',
  tenant: 'psc',
  title: 'File numbers: where to find yours',
  bodyEn:
    'Your personnel file number is on your payslip.\n\n- It has 8 to 10 digits.\n- Do not use your **KRA PIN**.',
  bodySw: 'Nambari yako ya faili iko kwenye hati yako ya mshahara.',
  tags: ['bio'],
  effectiveFrom: '2026-07-01',
  effectiveTo: null,
  published: true,
  version: 3,
  updatedAt: '2026-09-12T08:20:00.000Z',
};

const DRAFT: HelpArticle = {
  ...FILE_NUMBERS,
  id: '0199c0de-a000-7000-8000-000000000008',
  title: 'Acting appointments',
  bodySw: null,
  published: false,
  version: 1,
};

function renderEditor(props: Partial<ComponentProps<typeof ArticleEditor>> = {}) {
  const save = vi.fn<SaveArticle>();
  const onSaved = vi.fn();
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
          <ArticleEditor
            workspace={ADMIN}
            article={FILE_NUMBERS}
            today={TODAY}
            save={save}
            onSaved={onSaved}
            onUnauthenticated={vi.fn()}
            {...props}
          />
        </HelpSessionContext>
      </TooltipProvider>
    </ToastProvider>,
  );
  return { save, onSaved, session };
}

const titleBox = () => screen.getByRole('textbox', { name: 'Title' });

beforeEach(() => {
  router.blocker.status = 'idle';
});

describe('article editor (spec 11 FE-4, S9)', () => {
  it('opens a published article with its version, both bodies and its tags', () => {
    renderEditor();
    expect(
      screen.getByRole('heading', { level: 1, name: 'File numbers: where to find yours' }),
    ).toBeTruthy();
    expect(screen.getAllByText('Published')).toHaveLength(2);
    expect(screen.getByText(/^Version 3 · updated 12 Sep 2026, 11:20$/)).toBeTruthy();
    expect((titleBox() as HTMLInputElement).value).toBe(FILE_NUMBERS.title);
    expect(screen.getByRole('textbox', { name: 'Body in English' })).toHaveProperty(
      'value',
      FILE_NUMBERS.bodyEn,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Kiswahili' }));
    expect(screen.getByRole('textbox', { name: 'Body in Kiswahili' })).toHaveProperty(
      'value',
      FILE_NUMBERS.bodySw,
    );
    expect(screen.getByText('Optional. Without it, Kiswahili users see the English.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bio data', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About tags' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Published' })).toHaveProperty('checked', true);
  });

  it('previews paragraphs, lists and bold as declarants read them', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('radio', { name: 'Preview' }));
    expect(screen.queryByRole('textbox', { name: 'Body in English' })).toBeNull();
    expect(screen.getByText('It has 8 to 10 digits.').tagName).toBe('SPAN');
    expect(screen.getByText('KRA PIN').tagName).toBe('B');
  });

  it('starts a new article unsaved and unpublished, and lists what to fix', async () => {
    const { save } = renderEditor({ article: null });
    expect(screen.getByRole('heading', { level: 1, name: 'New article' })).toBeTruthy();
    expect(screen.getByText('Not saved')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Published' })).toHaveProperty('checked', false);
    fireEvent.change(screen.getByRole('textbox', { name: /Until/ }), {
      target: { value: '01/01/2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const summary = await screen.findByRole('alert', { name: 'Fix these 3 before saving' });
    expect(within(summary).getByRole('link', { name: 'Enter a title.' })).toBeTruthy();
    expect(within(summary).getByRole('link', { name: 'Write the English text.' })).toBeTruthy();
    expect(
      within(summary).getByRole('link', { name: 'The end date must be after the start date.' }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(summary).getByRole('link', { name: 'Enter a title.' }));
    expect(document.activeElement).toBe(titleBox());
  });

  it('shows the corpus topics on request, keeping the toggle and its focus', () => {
    renderEditor();
    const toggle = screen.getByRole('button', { name: 'Show topics (34)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Material change' })).toBeNull();
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide topics');
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole('button', { name: 'Material change', pressed: false })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: 'Material change' })).toBeNull();
  });

  it('opens with the topics shown when one is chosen', () => {
    renderEditor({ article: { ...FILE_NUMBERS, tags: ['bio', 'employment'] } });
    expect(screen.getByRole('button', { name: 'Hide topics' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Employment', pressed: true })).toBeTruthy();
  });

  it('starts an article for a question theme with its name and tag', () => {
    renderEditor({ article: null, initial: { title: 'Vehicles', tags: ['vehicle'] } });
    expect((titleBox() as HTMLInputElement).value).toBe('Vehicles');
    expect(screen.getByRole('button', { name: 'Vehicle', pressed: true })).toBeTruthy();
  });

  it('publishes a draft: saves it, tells who can now find it and marks it just published', async () => {
    let resolve: (result: HelpResult<HelpArticle>) => void = () => undefined;
    const { save, onSaved, session } = renderEditor({ article: DRAFT });
    save.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Published' }));
    expect(screen.getByText("Your Commission's declarants can find it.")).toBeTruthy();
    expect(router.shouldBlock?.()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true);
    expect(save).toHaveBeenCalledWith({
      scope: { kind: 'commission', slug: 'psc' },
      articleId: DRAFT.id,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      input: {
        title: 'Acting appointments',
        bodyEn: DRAFT.bodyEn,
        bodySw: null,
        tags: ['bio'],
        effectiveFrom: '2026-07-01',
        effectiveTo: null,
        published: true,
      },
    });
    const saved = { ...DRAFT, published: true, version: 2 };
    await act(async () => {
      resolve({ ok: true, data: saved });
      await Promise.resolve();
    });
    expect(
      await screen.findByText("Published. Your Commission's declarants can find it now."),
    ).toBeTruthy();
    expect(session.setJustPublished).toHaveBeenCalledWith(DRAFT.id);
    expect(onSaved).toHaveBeenCalledWith(saved, false);
    expect(router.shouldBlock?.()).toBe(false);
  });

  it("shows the service's validation refusal on the fields", async () => {
    const { save } = renderEditor();
    save.mockResolvedValue({
      ok: false,
      error: {
        kind: 'problem',
        problem: {
          type: 'about:blank',
          title: 'Validation failed',
          status: 400,
          errors: [{ path: 'title', message: 'Too big: expected string to have <=200 characters' }],
        },
      },
    });
    fireEvent.change(titleBox(), { target: { value: 'File numbers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('alert', { name: 'The article was not saved' });
    expect(
      screen.getAllByText('Adili did not accept this title. Check it and try again.'),
    ).toHaveLength(2);
    expect(titleBox().getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the changes when the save fails on the network, and retries with the same key', async () => {
    const { save } = renderEditor();
    save.mockResolvedValue({ ok: false, error: { kind: 'unavailable', detail: null } });
    fireEvent.change(titleBox(), { target: { value: 'File numbers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const summary = await screen.findByRole('alert', { name: 'Could not save' });
    expect(
      within(summary).getByText(
        'Check your connection and try again. Your changes are still here.',
      ),
    ).toBeTruthy();
    expect((titleBox() as HTMLInputElement).value).toBe('File numbers');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(save.mock.calls[1]?.[0].idempotencyKey).toBe(save.mock.calls[0]?.[0].idempotencyKey);
  });

  it('asks before leaving with unsaved changes', () => {
    router.blocker.status = 'blocked';
    renderEditor();
    const dialog = screen.getByRole('dialog', { name: 'Discard changes?' });
    expect(within(dialog).getByText('Your changes to this article are not saved.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(router.blocker.reset).toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(router.blocker.proceed).toHaveBeenCalled();
  });

  it('refuses reporting officers a new article, with the way back', () => {
    const { save } = renderEditor({ workspace: { ...ADMIN, readOnly: true }, article: null });
    expect(
      screen.getByText("Only your Commission's administrators write help articles."),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to articles' }).getAttribute('href')).toBe(
      '/help',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('gives reporting officers the article to read, without a form', () => {
    renderEditor({ workspace: { ...ADMIN, readOnly: true }, article: DRAFT });
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText('Do not use your', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Kiswahili' }));
    expect(screen.getByText('No Kiswahili text. Kiswahili users see the English.')).toBeTruthy();
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.getByText('Bio data')).toBeTruthy();
    expect(router.shouldBlock?.()).toBe(false);
  });
});
