// @vitest-environment jsdom
import { type AiLabelDetails, ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { issueDraft, saveDraft } from '../../../server/clarifications.server';
import { MOCK_DECLARATION, MOCK_ITEM_IDS } from '../../../server/review/copilot-mock.server';
import {
  MOCK_CASE_IDS as CASES,
  MOCK_CLARIFICATION_IDS as K,
  mockReviewClient,
  resetReviewMock,
} from '../../../server/review/mock.server';
import type { CaseListItem, Clarification } from '../../../server/review/types';
import {
  ClarificationComposer,
  type ClarificationComposerProps,
  type ComposerServer,
} from './clarification-composer';

vi.mock('../../../server/clarifications', () => ({
  saveClarificationDraft: vi.fn(),
  issueComposedClarification: vi.fn(),
}));

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';
const AI: AiLabelDetails = {
  task: 'draft-clarification',
  provider: 'anthropic',
  model: 'claude',
  promptVersion: 1,
  generatedAt: '2026-09-28T08:00:00Z',
};

const client = () => mockReviewClient(ME, 'Grace Wanjiru');

/** The server functions, answered by the review mock as the reviewer holding the cases. */
function mockServer(): ComposerServer & {
  save: ReturnType<typeof vi.fn>;
  issue: ReturnType<typeof vi.fn>;
} {
  return {
    save: vi.fn((input: Parameters<ComposerServer['save']>[0]) =>
      saveDraft(
        client(),
        input.caseId,
        input.clarificationId,
        { items: input.items, opening: input.opening },
        input.draftKey,
      ),
    ),
    issue: vi.fn((input: Parameters<ComposerServer['issue']>[0]) =>
      issueDraft(
        client(),
        input.caseId,
        input.clarificationId,
        { items: input.items, opening: input.opening },
        { draft: input.draftKey, issue: input.issueKey },
      ),
    ),
  };
}

async function caseOf(
  caseId: string,
): Promise<{ reviewCase: CaseListItem; clarifications: Clarification[] }> {
  const { data } = await client().GET('/v1/review/cases/{caseId}', {
    params: { path: { caseId } },
  });
  if (!data) throw new Error('no case');
  return { reviewCase: data.case, clarifications: data.clarifications };
}

function draftOnMine({ clarifications }: { clarifications: Clarification[] }): Clarification {
  const draft = clarifications.find((each) => each.id === K.draft);
  if (!draft) throw new Error('no draft');
  return draft;
}

beforeAll(() => {
  // Radix and scrolling in jsdom.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  resetReviewMock(Date.now());
});

async function renderComposer(
  props: Partial<ClarificationComposerProps> & { caseId?: string } = {},
) {
  const { reviewCase } = await caseOf(props.caseId ?? CASES.mine);
  const server = mockServer();
  const onIssued = vi.fn();
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <TooltipProvider>
      <ToastProvider>
        <ClarificationComposer
          open
          onOpenChange={onOpenChange}
          reviewCase={reviewCase}
          document={MOCK_DECLARATION}
          commission={{ name: 'Teachers Service Commission', issuerCode: 'TSC' }}
          now={NOW}
          server={server}
          onIssued={onIssued}
          onSaved={onSaved}
          {...props}
        />
      </ToastProvider>
    </TooltipProvider>,
  );
  return { server, onIssued, onSaved, onOpenChange };
}

const drawer = () => screen.getByRole('dialog');
const item = (n: number) => within(drawer()).getByRole('region', { name: `Item ${String(n)}` });

function pickTarget(card: HTMLElement, label: string) {
  fireEvent.click(within(card).getByRole('button', { name: /What is this about\?/ }));
  fireEvent.click(within(card).getByRole('option', { name: label }));
}

function fillItem(card: HTMLElement, requirement: string, text: string) {
  fireEvent.click(within(card).getByRole('radio', { name: requirement }));
  fireEvent.change(within(card).getByRole('textbox', { name: 'What you need' }), {
    target: { value: text },
  });
}

describe('ClarificationComposer', () => {
  it('starts a new clarification with one item for the case’s declarant', async () => {
    await renderComposer();
    expect(within(drawer()).getByRole('heading', { name: 'New clarification' })).toBeTruthy();
    expect(
      within(drawer()).getByText('To John Kennedy Otieno · re: DCI-TSC-2026-0003418-P'),
    ).toBeTruthy();
    expect(within(drawer()).getAllByRole('region', { name: /^Item / })).toHaveLength(1);
    expect(within(drawer()).getByText('Response due 28 Oct 2026')).toBeTruthy();
  });

  it('grows an item’s text box with its text instead of scrolling inside it (e2e 11, 12)', async () => {
    await renderComposer();
    const text = within(drawer()).getByRole('textbox', { name: 'What you need' });
    expect(text.className).toContain('field-sizing-content');
    expect(text.className).not.toContain('resize-y');
  });

  it('calls a clarification on an earlier one a further clarification (CONTEXT.md, M6)', async () => {
    await renderComposer({ followUpOf: { reference: 'CLR-TSC-2026-0000042-K' } });
    expect(screen.getByRole('dialog', { name: 'Further clarification' })).toBeTruthy();
    expect(
      screen.getByText(
        'Further clarification on CLR-TSC-2026-0000042-K. Remove any items that were answered.',
      ),
    ).toBeTruthy();
  });

  it('offers the sections and items of the current version, searchable', async () => {
    await renderComposer();
    fireEvent.click(within(item(1)).getByRole('button', { name: /What is this about\?/ }));
    const list = within(drawer()).getByRole('listbox', { name: 'Sections and items' });
    expect(within(list).getByRole('group', { name: 'Declaration' })).toBeTruthy();
    expect(within(list).getByRole('group', { name: 'Lilian Akoth Otieno' })).toBeTruthy();
    fireEvent.change(
      within(drawer()).getByRole('combobox', { name: 'Filter sections and items' }),
      {
        target: { value: 'plot' },
      },
    );
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno']);
  });

  it('closes the list on Esc and keeps the drawer open', async () => {
    const { onOpenChange } = await renderComposer();
    fireEvent.click(within(item(1)).getByRole('button', { name: /What is this about\?/ }));
    const filter = within(drawer()).getByRole('combobox', { name: 'Filter sections and items' });
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(within(drawer()).queryByRole('listbox')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('picks with the arrow keys and Enter', async () => {
    await renderComposer();
    fireEvent.click(within(item(1)).getByRole('button', { name: /What is this about\?/ }));
    const filter = within(drawer()).getByRole('combobox', { name: 'Filter sections and items' });
    fireEvent.change(filter, { target: { value: 'lilian' } });
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    fireEvent.keyDown(filter, { key: 'Enter' });
    expect(
      within(item(1)).getByRole('button', {
        name: 'What is this about? Income · Profit from a cereals shop in Kibuye market · Lilian Akoth Otieno',
      }),
    ).toBeTruthy();
  });

  it('requires what each item is about, a requirement and the text (S19)', async () => {
    const { server } = await renderComposer();
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Issue clarification' }));
    expect(within(drawer()).getByText('Complete the highlighted items.')).toBeTruthy();
    expect(within(item(1)).getByText('Choose what this item is about.')).toBeTruthy();
    expect(within(item(1)).getByText('Choose what the declarant must do.')).toBeTruthy();
    expect(within(item(1)).getByText('Write what you need from the declarant.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Issue this clarification?' })).toBeNull();
    expect(server.issue).not.toHaveBeenCalled();
  });

  it('requires at least one item (S19)', async () => {
    const { server } = await renderComposer({
      draft: { ...draftOnMine(await caseOf(CASES.mine)), items: [] },
    });
    expect(within(drawer()).getByText('No items')).toBeTruthy();
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Issue clarification' }));
    expect(within(drawer()).getAllByText('Add at least one item.')).toHaveLength(2);
    expect(server.issue).not.toHaveBeenCalled();
  });

  it('issues after the confirm: CLR reference, toast, drawer closed (S12)', async () => {
    const { server, onIssued, onOpenChange } = await renderComposer();
    pickTarget(item(1), 'Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno');
    fillItem(item(1), 'Explain the discrepancy or inconsistency', 'Explain the 150% change.');
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Issue clarification' }));

    const confirm = screen.getByRole('dialog', { name: 'Issue this clarification?' });
    expect(
      within(confirm).getByText(
        'This sends a numbered letter to the declarant and starts their 30-day period. Continue?',
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Issue clarification' }));
      await Promise.resolve();
    });

    expect(server.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASES.mine,
        clarificationId: null,
        items: [
          {
            sectionKey: 'statement:officer',
            personKey: 'officer',
            itemId: MOCK_ITEM_IDS.plot,
            requirement: 'explain-discrepancy',
            text: 'Explain the 150% change.',
            aiJobId: null,
          },
        ],
      }),
    );
    const issued = onIssued.mock.calls[0]?.[0] as Clarification;
    expect(issued.status).toBe('issued');
    expect(screen.getByText(`${issued.reference ?? ''} issued`)).toBeTruthy();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the draft when the window has closed (409), and says until when', async () => {
    const { server } = await renderComposer({ caseId: CASES.windowClosed });
    pickTarget(item(1), 'Personal details');
    fillItem(item(1), 'Correct the entry', 'Correct your date of birth.');
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Issue clarification' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Issue this clarification?' })).getByRole(
          'button',
          { name: 'Issue clarification' },
        ),
      );
      await Promise.resolve();
    });
    const alert = within(drawer()).getByText(
      'This clarification could not be issued.',
    ).parentElement;
    expect(alert?.textContent).toMatch(
      /The clarification window closed on .+\. Your draft is kept\./,
    );
    expect(
      within(drawer())
        .getByRole('button', { name: 'Issue clarification' })
        .hasAttribute('disabled'),
    ).toBe(true);

    // Saving again updates the kept draft rather than making a second one.
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: 'Save draft' }));
      await Promise.resolve();
    });
    const kept = server.save.mock.calls[0]?.[0] as { clarificationId: string | null };
    expect(kept.clarificationId).toEqual(expect.any(String));
  });

  it('saves a draft with the started items, blank ones left out', async () => {
    const { server, onSaved } = await renderComposer();
    pickTarget(item(1), 'Personal details');
    fillItem(item(1), 'Correct the entry', 'Correct your date of birth.');
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Add item' }));
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: 'Save draft' }));
      await Promise.resolve();
    });
    expect(server.save.mock.calls[0]?.[0]).toMatchObject({
      clarificationId: null,
      items: [{ sectionKey: 'bio', requirement: 'correct', text: 'Correct your date of birth.' }],
    });
    expect((onSaved.mock.calls[0]?.[0] as Clarification).status).toBe('draft');
    expect(screen.getByText('Draft saved. The declarant cannot see it.')).toBeTruthy();
  });

  it('says when a drafted item no longer matches a Draft with AI of the case (400)', async () => {
    const { server } = await renderComposer();
    server.save.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: 'problem',
        problem: { type: 'ai-draft-not-on-case', title: 'Bad Request', status: 400 },
      },
    });
    pickTarget(item(1), 'Personal details');
    fillItem(item(1), 'Correct the entry', 'Correct your date of birth.');
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: 'Save draft' }));
      await Promise.resolve();
    });
    expect(
      screen.getByText(
        'An AI-drafted item or opening no longer matches a Draft with AI of this case. Discard it and draft again, or write it yourself.',
      ),
    ).toBeTruthy();
  });

  it('continues a saved draft with its items on their targets', async () => {
    const { clarifications } = await caseOf(CASES.mine);
    await renderComposer({ draft: draftOnMine({ clarifications }) });
    expect(within(drawer()).getByRole('heading', { name: 'Clarification draft' })).toBeTruthy();
    expect(
      within(item(1)).getByRole('button', {
        name: 'What is this about? Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno',
      }),
    ).toBeTruthy();
    expect(
      within(item(1)).getByRole('radio', { name: 'Explain the discrepancy or inconsistency' }),
    ).toHaveProperty('checked', true);
  });

  it('previews the letter with the items as the letter words them', async () => {
    await renderComposer();
    pickTarget(item(1), 'Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno');
    fillItem(item(1), 'Explain the discrepancy or inconsistency', 'Explain the 150% change.');
    fireEvent.click(within(drawer()).getByRole('radio', { name: /Letter preview/ }));
    const letter = within(drawer()).getByRole('article', { name: 'Letter preview' });
    expect(within(letter).getByText('Teachers Service Commission')).toBeTruthy();
    expect(within(letter).getByText('Allocated when issued (CLR-TSC-2026-…)')).toBeTruthy();
    expect(
      within(letter).getByText('Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno'),
    ).toBeTruthy();
    expect(within(letter).getByText('Explain the discrepancy or inconsistency.')).toBeTruthy();
    expect(letter.textContent).toContain('Please respond by 28 Oct 2026');
  });

  it('takes Draft with AI’s items through the tools slot, labelled until edited (07c FE-3)', async () => {
    await renderComposer({
      tools: (api) => (
        <button
          type="button"
          onClick={() => {
            api.insert({
              label: AI,
              jobId: null,
              opening: 'Thank you for your declaration.',
              items: [
                {
                  sectionKey: 'statement:officer',
                  personKey: 'officer',
                  itemId: MOCK_ITEM_IDS.fund,
                  requirement: 'provide-omitted',
                  text: 'Say when you bought the fund units.',
                },
              ],
            });
          }}
        >
          Draft with AI
        </button>
      ),
    });
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Draft with AI' }));
    expect(within(drawer()).getAllByRole('region', { name: /^Item / })).toHaveLength(1);
    expect(within(item(1)).getByRole('img', { name: /^AI draft\./ })).toBeTruthy();
    expect(within(drawer()).getByRole('textbox', { name: 'Opening paragraph' })).toBeTruthy();

    fireEvent.change(within(item(1)).getByRole('textbox', { name: 'What you need' }), {
      target: { value: 'Say when and how you bought the fund units.' },
    });
    expect(within(item(1)).getByRole('img', { name: /^AI draft, edited\./ })).toBeTruthy();
    fireEvent.click(within(item(1)).getByRole('button', { name: 'Discard drafted item 1' }));
    expect(within(drawer()).getByText('No items')).toBeTruthy();
  });
});
