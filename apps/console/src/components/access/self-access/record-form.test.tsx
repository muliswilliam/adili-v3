// @vitest-environment jsdom
import { ACCESS_OFFICER } from '@adili/roles';
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockAccessClient } from '../../../server/access/mock.server';
import {
  mockSelfAccessDocumentsClient,
  resetSelfAccessMock,
  setSelfAccessMockLatency,
} from '../../../server/access/self-access-mock.server';
import {
  completeProof,
  createProofUpload,
  findDeclarants,
  getDeclarantVersions,
  recordSelfAccessApplication,
} from '../../../server/self-access';
import {
  completeProofUpload,
  declarantVersions,
  recordApplication,
  reserveProofUpload,
  searchDeclarants,
} from '../../../server/self-access.server';
import { EMPTY_FORM, RecordApplicationForm, recordErrors, recordInput } from './record-form';

const navigate = vi.fn(() => Promise.resolve());

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../../server/self-access', () => ({
  findDeclarants: vi.fn(),
  getDeclarantVersions: vi.fn(),
  recordSelfAccessApplication: vi.fn(),
  createProofUpload: vi.fn(),
  completeProof: vi.fn(),
}));
vi.mock('../../roster/upload', () => ({ putFile: vi.fn(() => Promise.resolve('ok')) }));

const officer = () => mockAccessClient([ACCESS_OFFICER]);
const documents = () => mockSelfAccessDocumentsClient([ACCESS_OFFICER]);

beforeAll(() => {
  setSelfAccessMockLatency(0);
});
afterAll(() => {
  setSelfAccessMockLatency(1);
});
beforeEach(() => {
  resetSelfAccessMock();
  navigate.mockClear();
  // The server functions, answered by the mock as the access officer.
  vi.mocked(findDeclarants).mockImplementation(({ data }) =>
    searchDeclarants(officer(), data.slug, data.q),
  );
  vi.mocked(getDeclarantVersions).mockImplementation(({ data }) =>
    declarantVersions(officer(), data.slug, data.rosterRecordId),
  );
  vi.mocked(recordSelfAccessApplication).mockImplementation(({ data }) =>
    recordApplication(officer(), data.slug, data.input, data.idempotencyKey),
  );
  vi.mocked(createProofUpload).mockImplementation(({ data: { idempotencyKey, ...input } }) =>
    reserveProofUpload(documents(), input, idempotencyKey),
  );
  vi.mocked(completeProof).mockImplementation(({ data }) =>
    completeProofUpload(documents(), data.id, data.idempotencyKey),
  );
});

function renderForm() {
  render(
    <TooltipProvider>
      <ToastProvider>
        <RecordApplicationForm slug="psc" commissionCode="PSC" />
      </ToastProvider>
    </TooltipProvider>,
  );
}

async function chooseAlice() {
  fireEvent.change(
    screen.getByRole('searchbox', { name: 'Search the roster by name or file number' }),
    {
      target: { value: 'Wafula' },
    },
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Select Alice Nekesa Wafula' }));
  await screen.findByRole('radio', { name: /Biennial declaration 2026 · version 2/ });
}

function pick(label: string, file: File) {
  const field = screen.getByText(label, { selector: 'span' }).parentElement;
  if (!field) throw new Error(`No ${label} field`);
  const input = field.querySelector<HTMLInputElement>('input[type=file]');
  if (!input) throw new Error(`No file input for ${label}`);
  fireEvent.change(input, { target: { files: [file] } });
}

const pdf = (name: string) => new File([new Uint8Array(4096)], name, { type: 'application/pdf' });

describe('recordErrors and recordInput', () => {
  it('asks for the declarant and the check first, then the representative and the version', () => {
    expect(recordErrors(EMPTY_FORM)).toEqual({
      declarant: 'Find the declarant on the roster.',
      matches: 'Confirm the check before you record the application.',
    });
    expect(
      Object.keys(recordErrors({ ...EMPTY_FORM, applicant: 'representative', matches: true })),
    ).toEqual(['declarant', 'repName', 'repIdNumber', 'authority', 'identification']);
    expect(recordInput(EMPTY_FORM)).toBeNull();
  });
});

describe('RecordApplicationForm (slice #302)', () => {
  it('shows every problem at once and records nothing', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('radio', { name: 'A representative' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record and issue copy' }));

    expect(await screen.findByText('Fix 6 problems to continue.')).toBeTruthy();
    expect(screen.getByText('Find the declarant on the roster.')).toBeTruthy();
    expect(screen.getByText('Upload the written authority the declarant signed.')).toBeTruthy();
    expect(screen.getByText("Upload a copy of the representative's ID.")).toBeTruthy();
    expect(recordSelfAccessApplication).not.toHaveBeenCalled();
  });

  it('marks a declarant without an account as not onboarded, with nothing to select', async () => {
    renderForm();
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search the roster by name or file number' }),
      {
        target: { value: 'Kariuki' },
      },
    );
    const results = await screen.findByRole('list', { name: 'Roster records' });
    expect(within(results).getByText('Not onboarded')).toBeTruthy();
    expect(within(results).queryByRole('button')).toBeNull();
  });

  it("records a representative's application with both proofs and opens it", async () => {
    renderForm();
    await chooseAlice();
    // The version in force is chosen for the officer.
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: /Biennial declaration 2026 · version 2/ })
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'A representative' }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: "The declarant's details on the authority match the roster record",
      }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), {
      target: { value: 'Joseph Kiprono' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /ID number/ }), {
      target: { value: '23456789' },
    });
    pick('Written authority', pdf('authority.pdf'));
    await screen.findByText(/Scanned clean/);
    pick("Representative's ID", pdf('virus.pdf'));
    expect(await screen.findByText('Failed the virus check. Upload another file.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss virus.pdf' }));
    pick("Representative's ID", pdf('joseph-id.pdf'));
    await waitFor(() => {
      expect(screen.getAllByText(/Scanned clean/)).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Dispatch by post or courier' }));

    fireEvent.click(screen.getByRole('button', { name: 'Record and issue copy' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/access/certified-copies/$applicationId',
        params: { applicationId: expect.any(String) as string },
      });
    });
    expect(vi.mocked(recordSelfAccessApplication).mock.calls[0]?.[0].data.input).toEqual({
      rosterRecordId: 'a12d0000-0000-4000-8000-000000000001',
      declarationId: 'a12e0000-0000-4000-8000-000000000001',
      version: 2,
      identityNote:
        "The declarant's National ID on the written authority matches the roster record. The representative's ID was checked against them.",
      representative: {
        name: 'Joseph Kiprono',
        idNumber: '23456789',
        authorityUploadId: expect.any(String) as string,
        idUploadId: expect.any(String) as string,
      },
      deliveryMethod: 'dispatch',
    });
  });

  it('keeps the form and says why when the workflow engine cannot order the copy', async () => {
    vi.mocked(recordSelfAccessApplication).mockResolvedValue({
      ok: false,
      error: { kind: 'unavailable', detail: null, problemType: 'workflow-unavailable' },
    });
    renderForm();
    await chooseAlice();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'The document matches the roster record' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record and issue copy' }));

    expect(
      await screen.findByText('The copy cannot be ordered right now. Try again in a moment.'),
    ).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
