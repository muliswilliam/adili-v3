// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptDeclarationSuggestion,
  extractDeclarationAttachment,
  getDeclarationSection,
  listDeclarationSuggestions,
} from '../../server/declarations';
import type { LoadedSuggestion, LoadedSuggestionSet } from '../../server/declarations.server';
import { resetExtractionAvailability, useExtractionEnabled } from './extraction-availability';
import { ReadIntoForm, type ReadIntoFormProps, type ReadTarget } from './read-into-form';
import { DECLARATION_ID, renderWorkspace } from './testing';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());

const extractMock = vi.mocked(extractDeclarationAttachment);
const listMock = vi.mocked(listDeclarationSuggestions);
const acceptMock = vi.mocked(acceptDeclarationSuggestion);
const getSectionMock = vi.mocked(getDeclarationSection);

const KEY = 'statement:officer';
const ITEM_ID = '0b7e6a3c-1111-4222-8333-444455556666';
const NEW_ITEM = '0b7e6a3c-1111-4222-8333-444455557777';
const ATTACHMENT_ID = '9a8b7c6d-0000-4000-8000-000000000002';
const SET_ID = '5b000000-0000-4000-8000-000000000001';
const target: ReadTarget = { attachmentId: ATTACHMENT_ID, fileName: 'logbook-KCB782M.pdf' };

function suggestion(overrides: Partial<LoadedSuggestion> = {}): LoadedSuggestion {
  return {
    id: '5a000000-0000-4000-8000-000000000001',
    setId: SET_ID,
    personKey: 'officer',
    sectionKey: KEY,
    itemType: 'vehicle',
    fields: {
      'details.registration': 'KCB 782M',
      'details.makeModel': 'Toyota Premio',
      'value.kesCents': 95_000_000,
    },
    sourceRef: {
      documentKind: 'logbook',
      fields: [
        { name: 'details.registration', confidence: 0.97, page: 1 },
        { name: 'details.makeModel', confidence: 0.72, page: 1 },
        { name: 'value.kesCents', confidence: 0.41, page: 2 },
      ],
      warnings: ['Page 3 could not be read.'],
    },
    confidence: 0.41,
    matchItemId: null,
    status: 'new',
    acceptedItemId: null,
    ...overrides,
  };
}

function set(overrides: Partial<LoadedSuggestionSet> = {}): LoadedSuggestionSet {
  return {
    id: SET_ID,
    personKey: 'officer',
    source: 'document',
    status: 'pending',
    requestedAt: '2026-09-26T07:30:00Z',
    readyAt: null,
    verificationResultId: null,
    aiJobId: '5c000000-0000-4000-8000-000000000001',
    attachmentId: null,
    documentKind: null,
    reason: null,
    suggestions: [],
    ...overrides,
  };
}

const ready = (found = suggestion()) =>
  set({ status: 'ready', readyAt: '2026-09-26T07:31:00Z', suggestions: [found] });

const onApplied = vi.fn();
const onClose = vi.fn();

function Enabled() {
  return <p>{useExtractionEnabled(DECLARATION_ID) ? 'reading on' : 'reading off'}</p>;
}

function Harness(props: Partial<ReadIntoFormProps>) {
  const [open, setOpen] = useState<ReadTarget | null>(target);
  return (
    <>
      <Enabled />
      <ReadIntoForm
        target={open}
        sectionKey={KEY}
        itemId={ITEM_ID}
        itemType="vehicle"
        item={{ id: ITEM_ID, type: 'vehicle', description: 'My car', details: {} }}
        pollMs={5}
        pollLimit={3}
        onApplied={onApplied}
        onClose={() => {
          onClose();
          setOpen(null);
        }}
        {...props}
      />
    </>
  );
}

function renderSheet(props: Partial<ReadIntoFormProps> = {}) {
  return renderWorkspace(<Harness {...props} />, { step: KEY });
}

function sheet() {
  return screen.getByRole('dialog');
}

function read() {
  fireEvent.click(within(sheet()).getByRole('button', { name: 'Read document' }));
}

async function review() {
  renderSheet();
  read();
  await within(sheet()).findByRole('heading', { name: 'Check what was read' });
}

function field(label: string) {
  const control = within(sheet()).getByLabelText(label);
  const wrapper = control.closest('[data-field]');
  if (!(wrapper instanceof HTMLElement)) throw new Error(`No field ${label}`);
  return within(wrapper);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetExtractionAvailability();
  extractMock.mockResolvedValue({ status: 'started', set: set() });
  listMock.mockResolvedValue({ status: 'ok', sets: [ready()] });
  acceptMock.mockResolvedValue({
    status: 'accepted',
    suggestion: suggestion({ status: 'accepted', acceptedItemId: ITEM_ID }),
    itemId: ITEM_ID,
    etag: '"3"',
  });
  getSectionMock.mockResolvedValue({
    status: 'ok',
    etag: '"3"',
    section: {
      key: KEY,
      completeness: 'incomplete',
      draftVersion: 3,
      issues: [],
      contents: { assets: [{ id: ITEM_ID, type: 'vehicle' }] },
    },
  });
});

describe('Read into the form (S6, S11)', () => {
  it('asks what the document is, with the kind for the item chosen', () => {
    renderSheet();
    expect(within(sheet()).getByRole('heading', { name: 'Read into the form' })).toBeTruthy();
    expect(within(sheet()).getByText('logbook-KCB782M.pdf')).toBeTruthy();
    const kinds = within(sheet()).getByRole('radiogroup', { name: 'What is this document?' });
    expect(
      within(kinds)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['Title deed', 'Logbook', 'Payslip', 'Bank letter', 'Share certificate', 'Other']);
    expect(within(kinds).getByRole('radio', { name: 'Logbook' })).toHaveProperty('checked', true);
    expect(
      within(sheet()).getByText(/You check every field before anything is added/),
    ).toBeTruthy();
  });

  it('asks for the chosen kind, then shows Reading… while it polls', async () => {
    listMock.mockResolvedValue({ status: 'ok', sets: [set()] });
    renderSheet({ pollLimit: 100 });
    fireEvent.click(within(sheet()).getByRole('radio', { name: 'Title deed' }));
    read();
    expect(within(sheet()).getByRole('status').textContent).toContain('Reading…');
    expect(within(sheet()).getByText('This can take up to a minute.')).toBeTruthy();
    expect(extractMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        declarationId: DECLARATION_ID,
        attachmentId: ATTACHMENT_ID,
        documentKindHint: 'title-deed',
      }) as unknown,
    });
    await waitFor(() => {
      expect(listMock.mock.calls.length).toBeGreaterThan(1);
    });
    expect(listMock).toHaveBeenCalledWith({
      data: { declarationId: DECLARATION_ID, personKey: 'officer', sectionKey: KEY },
    });
    expect(within(sheet()).getByRole('status').textContent).toContain('Reading…');
  });

  it('stops polling on Cancel', async () => {
    listMock.mockResolvedValue({ status: 'ok', sets: [set()] });
    renderSheet({ pollLimit: 100 });
    read();
    await waitFor(() => {
      expect(listMock).toHaveBeenCalled();
    });
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    const calls = listMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(listMock.mock.calls.length).toBeLessThanOrEqual(calls + 1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows each field read with its confidence, page and warnings, editable', async () => {
    await review();
    expect(within(sheet()).getByText('logbook-KCB782M.pdf · Logbook')).toBeTruthy();
    expect(within(sheet()).getByText('Edit anything that is wrong.')).toBeTruthy();
    expect(within(sheet()).getByText('Page 3 could not be read.')).toBeTruthy();
    expect(field('Registration').getByText('High')).toBeTruthy();
    expect(field('Registration').getByText('Page 1')).toBeTruthy();
    expect(field('Make and model').getByText('Medium')).toBeTruthy();
    expect(field('Value').getByText('Low')).toBeTruthy();
    expect(field('Value').getByText('Page 2')).toBeTruthy();
    expect(field('Value').getByText('Confidence:', { exact: false })).toBeTruthy();
    expect(within(sheet()).getByLabelText('Registration')).toHaveProperty('value', 'KCB 782M');
    // An amount reads in shillings, though it is held in cents.
    expect(within(sheet()).getByLabelText('Value')).toHaveProperty('value', '950,000');
  });

  it('needs a tick on each Low field before anything is applied', async () => {
    await review();
    const add = within(sheet()).getByRole('button', { name: 'Add as new item' });
    const apply = within(sheet()).getByRole('button', { name: 'Apply to this item' });
    expect(add).toHaveProperty('disabled', true);
    expect(apply).toHaveProperty('disabled', true);
    expect(within(sheet()).getByText('Tick the Low field to continue.')).toBeTruthy();
    expect(field('Registration').queryByRole('checkbox')).toBeNull();
    fireEvent.click(
      within(sheet()).getByRole('checkbox', { name: 'I checked this against the document: Value' }),
    );
    expect(add).toHaveProperty('disabled', false);
    expect(apply).toHaveProperty('disabled', false);
    expect(within(sheet()).queryByText('Tick the Low field to continue.')).toBeNull();
  });

  it('applies the edited fields to this item through accept', async () => {
    await review();
    fireEvent.change(within(sheet()).getByLabelText('Make and model'), {
      target: { value: ' Toyota Premio, 2016 ' },
    });
    fireEvent.change(within(sheet()).getByLabelText('Value'), { target: { value: '900,000' } });
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: /I checked this/ }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Apply to this item' }));
    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledWith({
        itemId: ITEM_ID,
        contents: { assets: [{ id: ITEM_ID, type: 'vehicle' }] },
        mode: 'apply',
      });
    });
    expect(acceptMock).toHaveBeenCalledWith({
      data: {
        declarationId: DECLARATION_ID,
        suggestionId: suggestion().id,
        ifMatch: '"1"',
        fields: {
          'details.registration': 'KCB 782M',
          'details.makeModel': 'Toyota Premio, 2016',
          'value.kesCents': 90_000_000,
        },
        applyToItemId: ITEM_ID,
        overwrite: false,
      },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds the fields as a new item', async () => {
    acceptMock.mockResolvedValue({
      status: 'accepted',
      suggestion: suggestion({ status: 'accepted', acceptedItemId: NEW_ITEM }),
      itemId: NEW_ITEM,
      etag: '"3"',
    });
    await review();
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: /I checked this/ }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add as new item' }));
    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: NEW_ITEM, mode: 'new' }),
      );
    });
    expect(acceptMock.mock.calls[0]?.[0].data).toMatchObject({ applyToItemId: null });
    expect(acceptMock.mock.calls[0]?.[0].data).not.toHaveProperty('overwrite');
  });

  it('keeps what the declarant entered unless they choose to replace it', async () => {
    renderSheet({
      item: { id: ITEM_ID, type: 'vehicle', details: { registration: 'KCB 782N' } },
    });
    read();
    await within(sheet()).findByRole('heading', { name: 'Check what was read' });
    expect(within(sheet()).getByText('Registration: You entered: KCB 782N (kept)')).toBeTruthy();
    fireEvent.click(
      within(sheet()).getByRole('checkbox', { name: 'Replace details I already entered' }),
    );
    expect(
      within(sheet()).getByText('Registration: You entered: KCB 782N (replaced)'),
    ).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: /I checked this/ }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Apply to this item' }));
    await waitFor(() => {
      expect(acceptMock.mock.calls[0]?.[0].data).toMatchObject({ overwrite: true });
    });
  });

  it('refreshes a changed section and applies again', async () => {
    let answer: (value: Awaited<ReturnType<typeof acceptDeclarationSuggestion>>) => void = () =>
      undefined;
    acceptMock.mockResolvedValueOnce({ status: 'conflict', code: null }).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await review();
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: /I checked this/ }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Apply to this item' }));
    expect(await within(sheet()).findByText('Your statement changed. Refreshing…')).toBeTruthy();
    answer({
      status: 'accepted',
      suggestion: suggestion({ status: 'accepted', acceptedItemId: ITEM_ID }),
      itemId: ITEM_ID,
      etag: '"4"',
    });
    await waitFor(() => {
      expect(onApplied).toHaveBeenCalled();
    });
    expect(acceptMock.mock.calls[1]?.[0].data.ifMatch).toBe('"3"');
  });

  it('says so when applying fails, and keeps the sheet open', async () => {
    acceptMock.mockResolvedValue({ status: 'rejected', code: null });
    await review();
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: /I checked this/ }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add as new item' }));
    expect(
      await within(sheet()).findByText('The details could not be added. Try again.'),
    ).toBeTruthy();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('shows the failure copy for a document that could not be read, and tries again', async () => {
    listMock.mockResolvedValue({ status: 'ok', sets: [set({ status: 'failed' })] });
    renderSheet();
    read();
    expect(
      await within(sheet()).findByText(
        'Could not read this document (the document could not be processed). You can enter the details manually.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Try again' }));
    expect(
      within(sheet()).getByRole('radiogroup', { name: 'What is this document?' }),
    ).toBeTruthy();
  });

  it('gives the reason the service gives', async () => {
    listMock.mockResolvedValue({
      status: 'ok',
      sets: [set({ status: 'failed', reason: 'document-unreadable' })],
    });
    renderSheet();
    read();
    expect(
      await within(sheet()).findByText(
        'Could not read this document (the file is damaged, too long, or of a type that cannot be read). You can enter the details manually.',
      ),
    ).toBeTruthy();
  });

  it('ends the reading when its set is gone (another request was refused for the file)', async () => {
    listMock.mockResolvedValue({ status: 'ok', sets: [] });
    renderSheet({ pollLimit: 100 });
    read();
    expect(await within(sheet()).findByText(/\(the file is not ready to be read\)/)).toBeTruthy();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after about a minute of reading', async () => {
    listMock.mockResolvedValue({ status: 'ok', sets: [set()] });
    renderSheet();
    read();
    expect(
      await within(sheet()).findByText(
        'Could not read this document (it took too long). You can enter the details manually.',
      ),
    ).toBeTruthy();
    expect(listMock).toHaveBeenCalledTimes(3);
  });

  it('fails when the file is not ready or the service is down', async () => {
    extractMock.mockResolvedValue({ status: 'refused', code: 'not-clean' });
    renderSheet();
    read();
    expect(await within(sheet()).findByText(/\(the file is not ready to be read\)/)).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Try again' }));
    extractMock.mockResolvedValue({ status: 'unavailable' });
    read();
    expect(await within(sheet()).findByText(/\(the service is not available now\)/)).toBeTruthy();
  });

  it('learns that reading is off from a not-enabled answer and remembers it for the draft', async () => {
    extractMock.mockResolvedValue({ status: 'started', set: set({ status: 'not-enabled' }) });
    renderSheet();
    expect(screen.getByText('reading on')).toBeTruthy();
    read();
    expect(
      await within(sheet()).findByText(
        'Reading documents into the form is not enabled for your Commission.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('reading off')).toBeTruthy();
  });

  it('learns it from a not-enabled set too', async () => {
    listMock.mockResolvedValue({ status: 'ok', sets: [set({ status: 'not-enabled' })] });
    renderSheet();
    read();
    expect(await within(sheet()).findByText(/not enabled for your Commission/)).toBeTruthy();
    expect(screen.getByText('reading off')).toBeTruthy();
  });

  it('says when nothing could be read', async () => {
    listMock.mockResolvedValue({
      status: 'ok',
      sets: [ready(suggestion({ fields: {}, sourceRef: {} }))],
    });
    renderSheet();
    read();
    expect(
      await within(sheet()).findByText(
        'Nothing could be read from this document. You can enter the details manually.',
      ),
    ).toBeTruthy();
    expect(within(sheet()).queryByRole('button', { name: 'Apply to this item' })).toBeNull();
  });
});
