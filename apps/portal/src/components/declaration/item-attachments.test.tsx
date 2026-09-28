// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptDeclarationSuggestion,
  extractDeclarationAttachment,
  getDeclarationSection,
  linkDeclarationAttachment,
  listDeclarationSuggestions,
  unlinkDeclarationAttachment,
} from '../../server/declarations';
import type { LoadedSuggestion } from '../../server/declarations.server';
import {
  completeAttachmentUpload,
  createAttachmentUpload,
  getAttachmentUpload,
} from '../../server/documents/uploads';
import type { UploadCheck } from '../../server/documents/uploads.server';
import { putToPresignedUrl } from './attachment-upload';
import type { Attachment } from './contents';
import { markExtractionOff, resetExtractionAvailability } from './extraction-availability';
import type { ItemAttachmentSlot } from './statement-item-editor';
import { AttachmentUploadsProvider, ItemAttachments } from './item-attachments';
import { DECLARATION_ID, renderWorkspace, rowOf as row } from './testing';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());
vi.mock('../../server/documents/uploads', () => ({
  createAttachmentUpload: vi.fn(),
  completeAttachmentUpload: vi.fn(),
  getAttachmentUpload: vi.fn(),
}));
vi.mock(import('./attachment-upload'), async (importOriginal) => ({
  ...(await importOriginal()),
  putToPresignedUrl: vi.fn(),
}));

const reserveMock = vi.mocked(createAttachmentUpload);
const completeMock = vi.mocked(completeAttachmentUpload);
const checkMock = vi.mocked(getAttachmentUpload);
const putMock = vi.mocked(putToPresignedUrl);
const linkMock = vi.mocked(linkDeclarationAttachment);
const unlinkMock = vi.mocked(unlinkDeclarationAttachment);
const getSectionMock = vi.mocked(getDeclarationSection);
const extractMock = vi.mocked(extractDeclarationAttachment);
const listMock = vi.mocked(listDeclarationSuggestions);
const acceptMock = vi.mocked(acceptDeclarationSuggestion);

const ITEM_ID = '0b7e6a3c-1111-4222-8333-444455556666';
const UPLOAD_ID = '6f1d0c9e-0000-4000-8000-000000000001';
const ATTACHMENT_ID = '9a8b7c6d-0000-4000-8000-000000000002';
const SHA = 'a'.repeat(64);
const KEY = 'statement:officer';

const deed: Attachment = { uploadId: UPLOAD_ID, fileName: 'deed.pdf', sha256: SHA };

const setAttachmentsSpy = vi.fn();

type Extras = Partial<Pick<ItemAttachmentSlot, 'itemType' | 'onAccepted'>>;

function Harness({ initial, extras }: { initial: Attachment[]; extras: Extras }) {
  const [attachments, setAttachments] = useState(initial);
  return (
    <ItemAttachments
      slot={{
        itemType: 'vehicle',
        ...extras,
        sectionKey: KEY,
        category: 'assets',
        itemId: ITEM_ID,
        itemNoun: 'asset',
        attachments,
        setAttachments: (next) => {
          setAttachmentsSpy(next);
          setAttachments(next);
        },
        disabled: false,
      }}
    />
  );
}

function renderAttachments(initial: Attachment[] = [], extras: Extras = {}) {
  return renderWorkspace(
    <AttachmentUploadsProvider>
      <Harness initial={initial} extras={extras} />
    </AttachmentUploadsProvider>,
    { step: 'statement:officer' },
  );
}

function pick(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('No file input');
  fireEvent.change(input, { target: { files: [file] } });
}

function pdf(name = 'deed.pdf', size = 8 * 1024) {
  const file = new File(['%PDF'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function never<T>() {
  return new Promise<T>(() => undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetExtractionAvailability();
  reserveMock.mockResolvedValue({
    status: 'reserved',
    reservation: {
      id: UPLOAD_ID,
      uploadUrl: `/api/mock-uploads/${UPLOAD_ID}`,
      expiresAt: '2027-01-01T00:00:00Z',
      maxSize: 20 * 1024 * 1024,
    },
  });
  putMock.mockResolvedValue(undefined);
  completeMock.mockResolvedValue({ status: 'clean', sha256: SHA, size: 8 * 1024 });
  checkMock.mockResolvedValue({ status: 'scanning' } satisfies UploadCheck);
  linkMock.mockResolvedValue({
    status: 'linked',
    attachment: {
      id: ATTACHMENT_ID,
      sectionKey: KEY,
      itemId: ITEM_ID,
      uploadId: UPLOAD_ID,
      fileName: 'deed.pdf',
      sha256: SHA,
      size: 8 * 1024,
      linkedAt: '2027-01-01T00:00:00Z',
    },
  });
  unlinkMock.mockResolvedValue({ status: 'unlinked' });
  getSectionMock.mockResolvedValue({
    status: 'ok',
    etag: '"5"',
    section: {
      key: KEY,
      completeness: 'incomplete',
      draftVersion: 5,
      contents: { assets: [{ id: ITEM_ID, attachments: [{ ...deed }] }] },
    },
  });
});

describe('ItemAttachments (S10)', () => {
  it('explains the documents are optional and what they accept', () => {
    renderAttachments();
    expect(screen.getByRole('group', { name: 'Documents' })).toBeDefined();
    expect(
      screen.getByText(
        'Optional. A title deed, logbook, statement or payslip helps your Commission verify this item.',
      ),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add document' })).toBeDefined();
    expect(screen.getByText('PDF, JPEG, PNG or HEIC, up to 20 MB.')).toBeDefined();
  });

  it('lists documents already linked to the item', () => {
    renderAttachments([deed]);
    const list = screen.getByRole('list', { name: 'Documents for this asset' });
    expect(within(list).getByText('deed.pdf')).toBeDefined();
    expect(within(list).getByText('Attached')).toBeDefined();
  });

  it('shows upload progress', async () => {
    putMock.mockImplementation((_url, _file, _type, onProgress) => {
      onProgress(40);
      return never();
    });
    renderAttachments();
    pick(pdf());
    const progress = await screen.findByRole('progressbar', { name: 'Uploading deed.pdf' });
    expect(progress.getAttribute('aria-valuenow')).toBe('40');
    expect(reserveMock).toHaveBeenCalledWith({
      data: { contentType: 'application/pdf', size: 8 * 1024, fileName: 'deed.pdf' },
    });
  });

  it('shows the scan while the file is checked', async () => {
    completeMock.mockReturnValue(never());
    renderAttachments();
    pick(pdf());
    expect(await screen.findByText('Checking the file for viruses…')).toBeDefined();
  });

  it('links a clean file with autosave held, and shows its size', async () => {
    renderAttachments();
    pick(pdf());
    expect(await screen.findByText('8 KB · Attached')).toBeDefined();
    expect(linkMock).toHaveBeenCalledWith({
      data: {
        declarationId: DECLARATION_ID,
        sectionKey: KEY,
        itemId: ITEM_ID,
        uploadId: UPLOAD_ID,
      },
    });
    // The section is read back for the new ETag and the item's attachments.
    expect(getSectionMock).toHaveBeenCalledWith({
      data: { declarationId: DECLARATION_ID, sectionKey: KEY },
    });
    expect(setAttachmentsSpy).toHaveBeenLastCalledWith([deed]);
    const list = screen.getByRole('list', { name: 'Documents for this asset' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('deed.pdf attached.').getAttribute('role')).toBe('status');
  });

  it('refuses an infected file with the spec message', async () => {
    completeMock.mockResolvedValue({ status: 'infected' });
    renderAttachments();
    pick(pdf('virus.pdf'));
    expect(
      await screen.findByText('This file failed the security scan and was not attached.'),
    ).toBeDefined();
    expect(linkMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss virus.pdf' }));
    expect(screen.queryByText('virus.pdf')).toBeNull();
  });

  it('refuses a file of the wrong type without uploading it', () => {
    renderAttachments();
    pick(new File(['x'], 'valuation.docx', { type: 'application/msword' }));
    expect(
      row('valuation.docx').getByText(
        'This file type cannot be attached. Use a PDF, JPEG, PNG or HEIC file.',
      ),
    ).toBeDefined();
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it('refuses a file over 20 MB without uploading it', () => {
    renderAttachments();
    pick(pdf('scan.pdf', 21 * 1024 * 1024));
    expect(
      row('scan.pdf').getByText(
        'This file is larger than 20 MB. Use a smaller file or a lower-resolution photo.',
      ),
    ).toBeDefined();
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it('shows a failed upload and tries it again', async () => {
    putMock.mockRejectedValueOnce(new Error('network'));
    renderAttachments();
    pick(pdf('logbook.pdf'));
    expect(
      await screen.findByText('The upload did not finish. Check your connection and try again.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again: logbook.pdf' }));
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('8 KB · Attached')).toBeDefined();
  });

  it('fails when the service refuses to link the file', async () => {
    linkMock.mockResolvedValue({ status: 'refused' });
    renderAttachments();
    pick(pdf());
    expect(
      await screen.findByText('The upload did not finish. Check your connection and try again.'),
    ).toBeDefined();
    expect(setAttachmentsSpy).not.toHaveBeenCalled();
  });

  it('removes a document linked in this visit after confirming', async () => {
    renderAttachments();
    pick(pdf());
    await screen.findByText('8 KB · Attached');
    getSectionMock.mockResolvedValue({
      status: 'ok',
      etag: '"6"',
      section: {
        key: KEY,
        completeness: 'incomplete',
        draftVersion: 6,
        contents: { assets: [{ id: ITEM_ID, attachments: [] }] },
      },
    });

    // Linked in this visit, the file has a menu: Read into the form, then Remove.
    fireEvent.click(screen.getByRole('button', { name: 'Actions for deed.pdf' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove deed.pdf?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove document' }));
    await waitFor(() => {
      expect(screen.queryByText('deed.pdf')).toBeNull();
    });
    expect(unlinkMock).toHaveBeenCalledWith({
      data: { declarationId: DECLARATION_ID, attachmentId: ATTACHMENT_ID },
    });
    expect(setAttachmentsSpy).toHaveBeenLastCalledWith([]);
    expect(await screen.findByText('Document removed')).toBeDefined();
  });

  it('removes a document linked before this visit from the item', async () => {
    renderAttachments([deed]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove deed.pdf' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove deed.pdf?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove document' }));
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: 'Documents for this asset' })).toBeNull();
    });
    expect(unlinkMock).not.toHaveBeenCalled();
    expect(setAttachmentsSpy).toHaveBeenLastCalledWith([]);
  });
});

describe('Read into the form on an attachment (S6, S11)', () => {
  const read: LoadedSuggestion = {
    id: '5a000000-0000-4000-8000-000000000001',
    setId: '5b000000-0000-4000-8000-000000000001',
    personKey: 'officer',
    sectionKey: KEY,
    itemType: 'vehicle',
    fields: { registration: 'KCB 782M' },
    sourceRef: { fields: [{ name: 'registration', confidence: 0.95, page: 1 }] },
    confidence: 0.95,
    matchItemId: null,
    status: 'new',
    acceptedItemId: null,
  };

  async function linked(extras: Extras = {}) {
    renderAttachments([], extras);
    pick(pdf());
    await screen.findByText('8 KB · Attached');
    linkMock.mock.calls.length = 0;
  }

  function openMenu(name = 'deed.pdf') {
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
    return screen.getByRole('menu');
  }

  it('offers it for a file linked in this visit, whose attachment id is known', async () => {
    await linked();
    const menu = openMenu();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Read into the form', 'Remove']);
  });

  it('leaves it out for a file linked before this visit', () => {
    renderAttachments([deed]);
    expect(screen.queryByRole('button', { name: 'Actions for deed.pdf' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove deed.pdf' })).toBeDefined();
  });

  it('says it is not enabled once the Commission is known not to read documents', () => {
    markExtractionOff(DECLARATION_ID);
    renderAttachments([deed]);
    const menu = openMenu('deed.pdf');
    const note = within(menu).getByRole('menuitem', {
      name: 'Read into the form: not enabled for your Commission',
    });
    expect(note.getAttribute('aria-disabled')).toBe('true');
  });

  it('reads the document, applies it through accept and marks the row', async () => {
    const onAccepted = vi.fn();
    extractMock.mockResolvedValue({
      status: 'started',
      set: {
        id: read.setId,
        personKey: 'officer',
        source: 'document',
        status: 'ready',
        requestedAt: '2026-09-26T07:30:00Z',
        readyAt: '2026-09-26T07:30:00Z',
        verificationResultId: null,
        aiJobId: null,
        suggestions: [read],
      },
    });
    acceptMock.mockResolvedValue({
      status: 'accepted',
      suggestion: { ...read, status: 'accepted', acceptedItemId: ITEM_ID },
      itemId: ITEM_ID,
      etag: '"6"',
    });
    await linked({ onAccepted });
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Read into the form' }));
    const sheet = await screen.findByRole('dialog', { name: 'Read into the form' });
    expect(within(sheet).getByRole('radio', { name: 'Logbook' })).toHaveProperty('checked', true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Read document' }));
    const review = await screen.findByRole('dialog', { name: 'Check what was read' });
    fireEvent.click(within(review).getByRole('button', { name: 'Apply to this item' }));
    expect(await screen.findByText('Details applied to this item')).toBeDefined();
    expect(extractMock.mock.calls[0]?.[0].data).toMatchObject({
      attachmentId: ATTACHMENT_ID,
      documentKindHint: 'logbook',
      targetItemType: 'vehicle',
    });
    expect(acceptMock.mock.calls[0]?.[0].data).toMatchObject({
      suggestionId: read.id,
      applyToItemId: ITEM_ID,
    });
    expect(onAccepted).toHaveBeenCalledWith(ITEM_ID, {
      assets: [{ id: ITEM_ID, attachments: [deed] }],
    });
    expect(screen.getByText('8 KB · Read into the form')).toBeDefined();
    expect(listMock).not.toHaveBeenCalled();
  });
});
