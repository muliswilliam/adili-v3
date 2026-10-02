// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiDraft } from '../../../server/copilot-drafts.server';
import {
  MOCK_DECLARATION,
  MOCK_FLAG_IDS as F,
  MOCK_ITEM_IDS as I,
  mockFlags,
} from '../../../server/review/copilot-mock.server';
import {
  MOCK_CASE_IDS as CASES,
  mockReviewClient,
  resetReviewMock,
} from '../../../server/review/mock.server';
import type { CaseListItem, CopilotStatus } from '../../../server/review/types';
import type { ServiceResult } from '../../../server/service-call';
import { ClarificationComposer, type ComposerServer } from '../composer/clarification-composer';
import type { DraftServer } from './draft-with-ai';
import { useDraftWithAi } from './use-draft-with-ai';

vi.mock('../../../server/clarifications', () => ({
  saveClarificationDraft: vi.fn(),
  issueComposedClarification: vi.fn(),
}));
vi.mock('../../../server/copilot', () => ({
  draftClarificationWithAi: vi.fn(),
  getCopilotDraft: vi.fn(),
}));

const NOW = '2026-09-28T09:00:00.000Z';
const ME = 'a1b2c3d4-0000-4000-8000-000000000001';
const LABEL = {
  task: 'draft-clarification',
  provider: 'anthropic',
  model: 'claude-opus-5',
  promptVersion: 2,
  generatedAt: '2026-09-28T08:59:00.000Z',
  disclaimer: 'Indicators, not findings. A named reviewer decides.',
};
const DRAFT_JOB = '0199a000-0000-7000-8000-00000000d0b2';
const READY: AiDraft = {
  status: 'ready',
  id: 'd1',
  jobId: DRAFT_JOB,
  label: LABEL,
  opening: 'Thank you for your biennial declaration.',
  items: [
    {
      sectionKey: 'statement:officer',
      personKey: 'officer',
      itemId: I.plot,
      requirement: 'explain-discrepancy',
      text: 'Please explain the 150% increase in the value of the plot.',
    },
    {
      sectionKey: 'statement:officer',
      personKey: 'officer',
      itemId: I.fund,
      requirement: 'provide-omitted',
      text: 'Please declare when you acquired the fund units.',
    },
  ],
};
const ok = (data: AiDraft): ServiceResult<AiDraft> => ({ ok: true, data });
const PENDING = ok({ status: 'pending', id: 'd1' });
const unavailable: ServiceResult<AiDraft> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

let reviewCase: CaseListItem;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(async () => {
  resetReviewMock(Date.parse(NOW));
  const { data } = await mockReviewClient(ME, 'Faith Achieng').GET('/v1/review/cases/{caseId}', {
    params: { path: { caseId: CASES.mine } },
  });
  if (!data) throw new Error('no case');
  reviewCase = data.case;
});

afterEach(() => {
  vi.useRealTimers();
});

function fakeDraftServer(
  answers: { request?: ServiceResult<AiDraft>; polls?: ServiceResult<AiDraft>[] } = {},
) {
  const polls = [...(answers.polls ?? [])];
  return {
    request: vi.fn<DraftServer['request']>(() => Promise.resolve(answers.request ?? ok(READY))),
    poll: vi.fn<DraftServer['poll']>(() => Promise.resolve(polls.shift() ?? ok(READY))),
  };
}

function fakeComposerServer() {
  return {
    save: vi.fn<ComposerServer['save']>(() =>
      Promise.resolve({ ok: false, error: { kind: 'unavailable', detail: null } }),
    ),
    issue: vi.fn<ComposerServer['issue']>(),
  };
}

/** A case's composer and its Draft with AI, wired as the case view wires them. */
function Host({
  server,
  composer,
  copilotStatus = null,
}: {
  server: DraftServer;
  composer: ComposerServer;
  copilotStatus?: CopilotStatus | null;
}) {
  const [open, setOpen] = useState(true);
  const drafting = useDraftWithAi({
    caseId: CASES.mine,
    flags: mockFlags(CASES.mine),
    copilotStatus,
    server,
  });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          drafting.copilotSelection.onToggle(F.valueChange);
        }}
      >
        Add to clarification
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Reopen
      </button>
      <ClarificationComposer
        open={open}
        onOpenChange={setOpen}
        reviewCase={reviewCase}
        document={MOCK_DECLARATION}
        commission={{ name: 'Teachers Service Commission', issuerCode: 'TSC' }}
        now={NOW}
        server={composer}
        tools={drafting.tools}
      />
    </>
  );
}

function renderHost(props: Partial<Parameters<typeof Host>[0]> = {}) {
  const server = props.server ?? fakeDraftServer();
  const composer = props.composer ?? fakeComposerServer();
  const tree = (copilotStatus: CopilotStatus | null | undefined) => (
    <TooltipProvider>
      <ToastProvider>
        <Host server={server} composer={composer} copilotStatus={copilotStatus} />
      </ToastProvider>
    </TooltipProvider>
  );
  const { rerender } = render(tree(props.copilotStatus));
  return {
    server,
    composer,
    /** Rerenders with the copilot's status changed. */
    setCopilotStatus: (status: CopilotStatus | null) => {
      rerender(tree(status));
    },
  };
}

const drawer = () => screen.getByRole('dialog');
const drafting = () => within(drawer()).getByRole('region', { name: 'Draft with AI' });
const draftButton = () =>
  within(drafting()).getByRole('button', { name: /^(Draft with AI|Drafting…)$/ });
const items = () => within(drawer()).getAllByRole('region', { name: /^Item / });
function itemCard(index: number): HTMLElement {
  const card = items()[index];
  if (!card) throw new Error(`no item ${String(index + 1)}`);
  return card;
}

/** Chooses the letter's language in the composer. */
function letterIn(language: string) {
  fireEvent.keyDown(within(drawer()).getByRole('combobox', { name: 'Letter language' }), {
    key: 'Enter',
  });
  fireEvent.click(screen.getByRole('option', { name: language }));
}

function pick(name: string) {
  fireEvent.keyDown(
    within(drafting()).getByRole('combobox', { name: 'Add a flag or item to draft from' }),
    { key: 'Enter' },
  );
  fireEvent.click(screen.getByRole('option', { name }));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('Draft with AI in the composer (spec 07c FE-3, S12)', () => {
  it('needs a flag or item first; picks show as chips, from the list or the copilot', () => {
    renderHost();
    expect(draftButton().hasAttribute('disabled')).toBe(true);

    pick('Value changed by 150% since the previous declaration');
    pick('Plot Kisumu/Manyatta/1234 (John Kennedy Otieno)');
    expect(
      within(drafting()).getByRole('button', {
        name: 'Remove Value changed by 150% since the previous declaration',
      }),
    ).toBeTruthy();
    expect(
      within(drafting()).getByRole('button', { name: 'Remove Plot Kisumu/Manyatta/1234' }),
    ).toBeTruthy();
    expect(draftButton().hasAttribute('disabled')).toBe(false);

    // The copilot's "Add to clarification" is the same selection: here, it unpicks the flag.
    fireEvent.click(screen.getByRole('button', { name: 'Add to clarification', hidden: true }));
    expect(
      within(drafting()).queryByRole('button', {
        name: 'Remove Value changed by 150% since the previous declaration',
      }),
    ).toBeNull();
  });

  it('inserts a ready draft as labelled items and the opening paragraph, then clears the picks', async () => {
    const { server } = renderHost();
    fireEvent.click(screen.getByRole('button', { name: 'Add to clarification', hidden: true }));
    pick('Plot Kisumu/Manyatta/1234 (John Kennedy Otieno)');
    letterIn('Swahili');

    fireEvent.click(draftButton());
    expect(draftButton().textContent).toBe('Drafting…');
    await settle();

    expect(server.request).toHaveBeenCalledWith({
      caseId: CASES.mine,
      key: expect.any(String) as string,
      flagIds: [F.valueChange],
      itemRefs: [
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: I.plot,
          requirement: null,
        },
      ],
      language: 'sw',
    });
    // The lone blank item made way; each drafted item is labelled until changed.
    expect(items()).toHaveLength(2);
    for (const card of items()) {
      expect(
        within(card).getByRole('img', { name: /^AI draft\. Clarification draft/ }),
      ).toBeTruthy();
    }
    expect(within(itemCard(0)).getByRole('textbox', { name: 'What you need' })).toHaveProperty(
      'value',
      'Please explain the 150% increase in the value of the plot.',
    );
    const opening = within(drawer()).getByRole('textbox', { name: 'Opening paragraph' });
    expect(opening).toHaveProperty('value', 'Thank you for your biennial declaration.');
    expect(screen.getByText('2 draft items added. Check each one before issuing.')).toBeTruthy();
    expect(within(drafting()).queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(draftButton().hasAttribute('disabled')).toBe(true);

    fireEvent.change(within(itemCard(1)).getByRole('textbox', { name: 'What you need' }), {
      target: { value: 'Please declare the acquisition date.' },
    });
    expect(within(itemCard(1)).getByRole('img', { name: /^AI draft, edited\./ })).toBeTruthy();
  });

  it('drafts in the letter’s language, and says so of a part drafted in another one (e2e 13, S7)', async () => {
    const server = fakeDraftServer();
    renderHost({ server });
    expect(within(drafting()).getByText("Drafts in English, the letter's language.")).toBeTruthy();
    pick('Value changed by 150% since the previous declaration');
    // An English draft in an English letter: nothing to say.
    fireEvent.click(draftButton());
    await settle();
    expect(server.request.mock.calls[0]?.[0].language).toBe('en');
    expect(within(drawer()).queryByText(/^Drafted in /)).toBeNull();

    // The letter turns Swahili: the English parts say so, edited or not; a new draft is Swahili.
    letterIn('Swahili');
    expect(within(drafting()).getByText("Drafts in Swahili, the letter's language.")).toBeTruthy();
    const note = 'Drafted in English. The letter is in Swahili.';
    expect(within(itemCard(0)).getByText(note)).toBeTruthy();
    fireEvent.change(within(itemCard(1)).getByRole('textbox', { name: 'What you need' }), {
      target: { value: 'Please declare the acquisition date.' },
    });
    expect(within(itemCard(1)).getByText(note)).toBeTruthy();
    expect(within(drawer()).queryByText(/rest of the letter|mix two languages/)).toBeNull();

    pick('Plot Kisumu/Manyatta/1234 (John Kennedy Otieno)');
    fireEvent.click(draftButton());
    await settle();
    expect(server.request.mock.calls[1]?.[0].language).toBe('sw');
    expect(items()).toHaveLength(4);
    expect(within(itemCard(2)).queryByText(/^Drafted in /)).toBeNull();
    expect(within(itemCard(3)).queryByText(/^Drafted in /)).toBeNull();
  });

  it('holds the letter language while drafting, so the draft lands in the language it was asked in (Q35)', async () => {
    let answer: (result: ServiceResult<AiDraft>) => void = () => undefined;
    const server = fakeDraftServer();
    server.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderHost({ server });
    const language = () => within(drawer()).getByRole('combobox', { name: 'Letter language' });
    pick('Value changed by 150% since the previous declaration');
    expect(language().hasAttribute('data-disabled')).toBe(false);

    fireEvent.click(draftButton());
    expect(language().hasAttribute('data-disabled')).toBe(true);

    await act(async () => {
      answer(ok(READY));
      await Promise.resolve();
    });
    expect(items()).toHaveLength(2);
    expect(language().hasAttribute('data-disabled')).toBe(false);
  });

  it('saves the opening paragraph with the items, each drafted part with its job (ADR-007)', async () => {
    const { composer } = renderHost();
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Save draft' }));
    await settle();

    expect(composer.save).toHaveBeenCalledWith(
      expect.objectContaining({
        opening: 'Thank you for your biennial declaration.',
        openingAiJobId: DRAFT_JOB,
        items: [
          expect.objectContaining({ itemId: I.plot, aiJobId: DRAFT_JOB }),
          expect.objectContaining({ itemId: I.fund, aiJobId: DRAFT_JOB }),
        ],
      }),
    );
  });

  it('polls a draft still being written, then inserts it', async () => {
    vi.useFakeTimers();
    const { server } = renderHost({
      server: fakeDraftServer({ request: PENDING, polls: [unavailable, PENDING, ok(READY)] }),
    });
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();

    expect(within(drafting()).getByRole('status').textContent).toBe(
      'Still drafting. Checking again…',
    );
    // 2, 3 and 5 seconds; the poll the service did not answer is asked again.
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(items()).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(server.poll).toHaveBeenCalledTimes(3);
    expect(server.poll).toHaveBeenCalledWith('d1');
    expect(items()).toHaveLength(2);
    expect(within(drafting()).getByRole('status').textContent).toBe('');
  });

  it('gives up after two minutes of drafting', async () => {
    vi.useFakeTimers();
    const pending = Array.from({ length: 20 }, () => PENDING);
    renderHost({ server: fakeDraftServer({ request: PENDING, polls: pending }) });
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();

    await act(() => vi.advanceTimersByTimeAsync(125_000));

    expect(
      screen.getByText('Draft not available (timed out). You can write the items manually.'),
    ).toBeTruthy();
    expect(draftButton().textContent).toBe('Draft with AI');
  });

  it('stops polling when the composer closes', async () => {
    vi.useFakeTimers();
    const { server } = renderHost({ server: fakeDraftServer({ request: PENDING }) });
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Close' }));
    await act(() => vi.advanceTimersByTimeAsync(30_000));

    expect(server.poll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    // The picks are the case's, not the composer's: still there.
    expect(
      within(drafting()).getByRole('button', {
        name: 'Remove Value changed by 150% since the previous declaration',
      }),
    ).toBeTruthy();
  });

  it('is ready again when the draft call itself throws, instead of drafting forever', async () => {
    const server = fakeDraftServer();
    server.request.mockRejectedValueOnce(new Error('Failed to fetch'));
    renderHost({ server });
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();

    expect(
      screen.getByText(
        'Draft not available (AI service unavailable). You can write the items manually.',
      ),
    ).toBeTruthy();
    expect(draftButton().textContent).toBe('Draft with AI');
    expect(draftButton().hasAttribute('disabled')).toBe(false);
    expect(drafting().getAttribute('aria-busy')).toBe('false');
  });

  it('retries a draft that got no answer with the same Idempotency-Key, a new pick with a new one (M5)', async () => {
    const server = fakeDraftServer();
    server.request.mockResolvedValueOnce(unavailable);
    server.request.mockRejectedValueOnce(new Error('Failed to fetch'));
    server.request.mockResolvedValueOnce(ok({ status: 'failed', id: 'd1', reason: 'provider' }));
    renderHost({ server });
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();
    fireEvent.click(draftButton());
    await settle();
    fireEvent.click(draftButton());
    await settle();
    const keys = server.request.mock.calls.map(([request]) => request.key);
    // The first two got no answer (timed out, network): the draft may still be written, so the
    // retries ask for the same one rather than start (and pay for) another.
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);

    // That draft failed: another try is a new draft.
    fireEvent.click(draftButton());
    await settle();
    expect(server.request.mock.calls[3]?.[0].key).not.toBe(keys[0]);

    // So is one from another selection.
    server.request.mockResolvedValueOnce(unavailable);
    pick('Plot Kisumu/Manyatta/1234 (John Kennedy Otieno)');
    fireEvent.click(draftButton());
    await settle();
    const changed = server.request.mock.calls[4]?.[0].key;
    expect(changed).not.toBe(server.request.mock.calls[3]?.[0].key);
    letterIn('Swahili');
    fireEvent.click(draftButton());
    await settle();
    expect(server.request.mock.calls[5]?.[0].key).not.toBe(changed);
  });

  it('says a failed draft is not available and keeps the picks for another try', async () => {
    renderHost({
      server: fakeDraftServer({ request: ok({ status: 'failed', id: 'd1', reason: 'budget' }) }),
    });
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();

    expect(
      screen.getByText(
        'Draft not available (monthly AI budget used up). You can write the items manually.',
      ),
    ).toBeTruthy();
    expect(items()).toHaveLength(1);
    expect(draftButton().hasAttribute('disabled')).toBe(false);
  });

  it('turns itself off when the review service says AI is not enabled (409)', async () => {
    renderHost({
      server: fakeDraftServer({
        request: {
          ok: false,
          error: {
            kind: 'problem',
            problem: { type: 'ai-not-enabled', title: 'Conflict', status: 409 },
          },
        },
      }),
    });
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();

    expect(within(drafting()).getByText('Not enabled for this Commission')).toBeTruthy();
    expect(draftButton().hasAttribute('disabled')).toBe(true);
    expect(
      screen.getAllByText('AI assistance is not enabled for this Commission.'),
    ).not.toHaveLength(0);
  });

  it('turns itself on again once the copilot is no longer not-enabled (Q9)', async () => {
    const { setCopilotStatus } = renderHost({
      copilotStatus: 'ready',
      server: fakeDraftServer({
        request: {
          ok: false,
          error: {
            kind: 'problem',
            problem: { type: 'ai-not-enabled', title: 'Conflict', status: 409 },
          },
        },
      }),
    });
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();
    expect(draftButton().hasAttribute('disabled')).toBe(true);

    // A refresh found the Commission not enabled, then (after an admin enabled it) ready.
    setCopilotStatus('not-enabled');
    setCopilotStatus('ready');
    expect(within(drafting()).queryByText('Not enabled for this Commission')).toBeNull();
    expect(draftButton().hasAttribute('disabled')).toBe(false);
  });

  it('is off from the start when the copilot is not enabled for the Commission', () => {
    renderHost({ copilotStatus: 'not-enabled' });
    expect(within(drafting()).getByText('Not enabled for this Commission')).toBeTruthy();
    expect(within(drafting()).queryByRole('combobox')).toBeNull();
    expect(draftButton().hasAttribute('disabled')).toBe(true);
  });

  it('tells the reviewer when only the reviewer holding the case may draft (403)', async () => {
    renderHost({
      server: fakeDraftServer({
        request: {
          ok: false,
          error: {
            kind: 'problem',
            problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
          },
        },
      }),
    });
    pick('Value changed by 150% since the previous declaration');
    fireEvent.click(draftButton());
    await settle();

    expect(screen.getByText('Only the reviewer holding the case can draft with AI.')).toBeTruthy();
  });
});
