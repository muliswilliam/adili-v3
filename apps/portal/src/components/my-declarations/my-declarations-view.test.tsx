// @vitest-environment jsdom
import { DCI, format } from '@adili/numbering/references';
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeclarationListItem, DeclarationVersion } from '../../server/declarations/types';
import { amendMyDeclaration, discardMyAmendment } from '../../server/declarations';
import { getMyDeclarationVersions } from '../../server/my-declarations';
import type { FiledDeclaration, MyDeclarationsPage } from '../../server/my-declarations.server';
import { getMySlipDownload } from '../../server/submission';
import { invalidate, navigate } from '../declaration/testing-mocks';
import { downloadFrom } from '../download';
import { MyDeclarationsView } from './my-declarations-view';
import { pageNumbers } from './pager';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/declarations', async () =>
  (await import('../declaration/testing-mocks')).serverMock(),
);
vi.mock('../../server/submission', async () =>
  (await import('../declaration/testing-mocks')).submissionMock(),
);
vi.mock('../../server/my-declarations', async () =>
  (await import('../declaration/testing-mocks')).myDeclarationsMock(),
);
vi.mock('../download', async () => (await import('../declaration/testing-mocks')).downloadMock());

const REFERENCE = format(DCI, { issuer: 'TSC', period: 2026, sequence: 12345 });
const TSC = { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' };
const ID = '7f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const DOC_V1 = '1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const DOC_V2 = '2d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function issued(documentId: string, verifiedCount = 0): DeclarationVersion['acknowledgement'] {
  return {
    status: 'issued',
    documentId,
    verificationId: 'ADL-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GG',
    verifyUrl: 'http://localhost:3030/v/ADL-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GG',
    issuedAt: '2026-09-26T07:43:00Z',
    verifiedCount,
    downloadUrl: null,
  };
}

function version(overrides: Partial<DeclarationVersion> = {}): DeclarationVersion {
  return {
    version: 1,
    reference: REFERENCE,
    submittedAt: '2026-09-26T07:42:00Z',
    late: false,
    canonicalSha256: 'a'.repeat(64),
    supersededAt: null,
    acknowledgement: issued(DOC_V1, 1),
    ...overrides,
  };
}

function filed(overrides: Partial<FiledDeclaration> = {}): FiledDeclaration {
  return {
    id: ID,
    obligationId: '0b1e5a1d-5c0a-4d3e-9f10-000000000002',
    type: 'initial',
    commission: TSC,
    statementDate: '2026-09-02',
    dueDate: '2026-10-02',
    status: 'submitted',
    completenessPercent: 100,
    reference: REFERENCE,
    currentVersion: 1,
    amendingFromVersion: null,
    submittedAt: '2026-09-26T07:42:00Z',
    late: false,
    amendable: true,
    acknowledgement: { status: 'issued', documentId: DOC_V1, verifiedCount: 1 },
    updatedAt: '2026-09-26T07:42:00Z',
    ...overrides,
  };
}

const twoVersions = [
  version({ version: 2, submittedAt: '2026-09-26T08:18:00Z', acknowledgement: issued(DOC_V2, 1) }),
  version({ supersededAt: '2026-09-26T08:18:00Z', acknowledgement: issued(DOC_V1, 3) }),
];

/** Version 2 in force, version 1 superseded. */
const amended = filed({
  currentVersion: 2,
  submittedAt: '2026-09-26T08:18:00Z',
  acknowledgement: { status: 'issued', documentId: DOC_V2, verifiedCount: 1 },
});

function draft(overrides: Partial<DeclarationListItem> = {}): DeclarationListItem {
  return {
    id: '0e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b',
    obligationId: '0b1e5a1d-5c0a-4d3e-9f10-000000000001',
    commission: TSC,
    type: 'biennial',
    statementDate: '2027-11-01',
    status: 'draft',
    completenessPercent: 40,
    dueDate: '2027-12-31',
    reference: null,
    currentVersion: null,
    amendingFromVersion: null,
    submittedAt: null,
    late: null,
    amendable: false,
    acknowledgement: null,
    updatedAt: '2026-09-29T09:00:00Z',
    ...overrides,
  };
}

function page(
  rows: MyDeclarationsPage['rows'],
  overrides: Partial<MyDeclarationsPage> = {},
): MyDeclarationsPage {
  return { status: 'ok', rows, page: 1, pageSize: 5, total: rows.length, ...overrides };
}

const onPage = vi.fn();
const onPageSize = vi.fn();

function renderView(result: Parameters<typeof MyDeclarationsView>[0]['result']) {
  return render(
    <ToastProvider>
      <MyDeclarationsView result={result} onPage={onPage} onPageSize={onPageSize} />
    </ToastProvider>,
  );
}

function renderFiled(declaration: FiledDeclaration) {
  renderView(page([{ kind: 'filed', declaration }]));
  return screen.getByRole('article', { name: 'Initial declaration' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('my declarations (spec 06 FE-4)', () => {
  it('shows a submitted declaration with its reference, Commission, dates, version and checks', () => {
    const row = renderFiled(filed());

    expect(screen.getByRole('heading', { level: 1, name: 'My declarations' })).toBeTruthy();
    expect(within(row).getByRole('heading', { name: 'Initial declaration' })).toBeTruthy();
    expect(within(row).getByText(REFERENCE)).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Copy reference number' })).toBeTruthy();
    expect(within(row).getByTitle('Teachers Service Commission').textContent).toBe('TSC');
    expect(within(row).getByText('Statement date 2 Sep 2026')).toBeTruthy();
    expect(within(row).getByText('Submitted 26 Sep 2026, 10:42')).toBeTruthy();
    expect(within(row).getByText('Version 1')).toBeTruthy();
    expect(within(row).getByText('Verified 1 time')).toBeTruthy();
    expect(within(row).getByText('Submitted')).toBeTruthy();
    expect(within(row).queryByText('Filed late')).toBeNull();
  });

  it('marks a late filing', () => {
    const row = renderFiled(filed({ late: true }));

    expect(within(row).getByText('Filed late')).toBeTruthy();
  });

  it('offers Amend while the service says it is open, before the due date (S19)', () => {
    const row = renderFiled(filed());

    expect(within(row).getByRole('button', { name: 'Amend Initial declaration' })).toBeTruthy();
    expect(within(row).queryByText(/Amendments closed/)).toBeNull();
  });

  it('says amendments are closed after the due date, without Amend (S19)', async () => {
    vi.mocked(getMyDeclarationVersions).mockResolvedValue({ status: 'ok', versions: [version()] });
    const row = renderFiled(filed({ amendable: false }));

    expect(within(row).queryByRole('button', { name: /Amend/ })).toBeNull();
    expect(within(row).getByText('Amendments closed 2 Oct 2026')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: /1 version/ }));
      await Promise.resolve();
    });
    expect(
      within(row).getByText('Due date passed. To change it, contact Teachers Service Commission.'),
    ).toBeTruthy();
  });

  it('downloads the slip through a fresh link', async () => {
    vi.mocked(getMySlipDownload).mockResolvedValue({
      status: 'ok',
      downloadUrl: '/api/mock-slips/v1',
    });
    const row = renderFiled(filed());

    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Download the slip of version 1' }));
      await Promise.resolve();
    });

    expect(getMySlipDownload).toHaveBeenCalledWith({ data: { documentId: DOC_V1 } });
    expect(downloadFrom).toHaveBeenCalledWith('/api/mock-slips/v1');
  });

  it('says when the slip could not be downloaded', async () => {
    vi.mocked(getMySlipDownload).mockResolvedValue({ status: 'unavailable' });
    const row = renderFiled(filed());

    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Download the slip of version 1' }));
      await Promise.resolve();
    });

    expect(downloadFrom).not.toHaveBeenCalled();
    expect(await screen.findByText('We could not download your slip. Try again.')).toBeTruthy();
  });

  it('says the slip is being prepared', () => {
    const row = renderFiled(
      filed({ acknowledgement: { status: 'pending', documentId: null, verifiedCount: 0 } }),
    );
    const preparing = within(row).getByRole<HTMLButtonElement>('button', {
      name: 'Slip being prepared',
    });
    expect(preparing.disabled).toBe(true);
  });

  it('links a failed slip to the success page, which asks for it again', () => {
    const row = renderFiled(
      filed({ acknowledgement: { status: 'failed', documentId: null, verifiedCount: 0 } }),
    );

    expect(within(row).getByRole('link', { name: 'Get your slip' }).getAttribute('href')).toBe(
      `/declarations/${ID}/submitted`,
    );
  });

  it('expands to every version, older ones superseded, each with its slip and checks', async () => {
    vi.mocked(getMySlipDownload).mockResolvedValue({ status: 'ok', downloadUrl: '/v1.pdf' });
    vi.mocked(getMyDeclarationVersions).mockResolvedValue({ status: 'ok', versions: twoVersions });
    const row = renderFiled(amended);
    expect(within(row).getByText('Version 2')).toBeTruthy();
    const toggle = within(row).getByRole('button', { name: /2 versions/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(row).queryByRole('list', { name: 'Versions of Initial declaration' })).toBeNull();

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(getMyDeclarationVersions).toHaveBeenCalledWith({ data: { declarationId: ID } });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const versions = within(row).getByRole('list', { name: 'Versions of Initial declaration' });
    const [v2, v1] = within(versions).getAllByRole('listitem');
    if (!v2 || !v1) throw new Error('two versions expected');
    expect(within(v2).getByText('Version 2')).toBeTruthy();
    expect(within(v2).getByText('In force')).toBeTruthy();
    expect(within(v2).getByText('Verified 1 time')).toBeTruthy();
    expect(within(v1).getByText('Version 1')).toBeTruthy();
    expect(within(v1).getByText('Superseded')).toBeTruthy();
    expect(within(v1).getByText('Submitted 26 Sep 2026, 10:42')).toBeTruthy();
    expect(within(v1).getByText('Verified 3 times')).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(v1).getByRole('button', { name: 'Download the slip of version 1' }));
      await Promise.resolve();
    });
    expect(getMySlipDownload).toHaveBeenCalledWith({ data: { documentId: DOC_V1 } });
    expect(within(row).queryByText(/Due date passed/)).toBeNull();

    // Collapsing and expanding again shows the versions already read.
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(getMyDeclarationVersions).toHaveBeenCalledTimes(1);
  });

  it('says while the versions load, and offers Try again when they could not be read', async () => {
    let answer: ((value: Awaited<ReturnType<typeof getMyDeclarationVersions>>) => void) | undefined;
    vi.mocked(getMyDeclarationVersions).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const row = renderFiled(amended);
    fireEvent.click(within(row).getByRole('button', { name: /2 versions/ }));
    expect(within(row).getByRole('status', { name: 'Loading the versions' })).toBeTruthy();

    await act(async () => {
      answer?.({ status: 'unavailable' });
      await Promise.resolve();
    });
    expect(within(row).getByText('We could not load the versions.')).toBeTruthy();

    vi.mocked(getMyDeclarationVersions).mockResolvedValueOnce({
      status: 'ok',
      versions: twoVersions,
    });
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Try again' }));
      await Promise.resolve();
    });
    expect(within(row).getByRole('list', { name: 'Versions of Initial declaration' })).toBeTruthy();
  });

  it('shows an amendment in progress with Continue and Discard amendment, without Amend', () => {
    const row = renderFiled(
      filed({ status: 'amending', amendingFromVersion: 1, amendable: false }),
    );

    expect(within(row).getByText('Amendment in progress')).toBeTruthy();
    expect(
      within(row)
        .getByRole('link', { name: 'Continue amendment: Initial declaration' })
        .getAttribute('href'),
    ).toBe(`/declarations/${ID}`);
    expect(
      within(row).getByRole('button', { name: 'Discard amendment: Initial declaration' }),
    ).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /^Amend/ })).toBeNull();
    expect(within(row).queryByRole('button', { name: /Download the slip/ })).toBeNull();
  });

  it('lists a draft with its completeness, Continue and Discard', () => {
    renderView(page([{ kind: 'draft', declaration: draft() }]));
    const row = screen.getByRole('article', { name: 'Biennial declaration 2027' });

    expect(within(row).getByText('Draft')).toBeTruthy();
    expect(within(row).getByText('40% complete')).toBeTruthy();
    expect(within(row).getByText('Saved 29 Sep 2026, 12:00')).toBeTruthy();
    expect(
      within(row)
        .getByRole('link', { name: 'Continue Biennial declaration 2027' })
        .getAttribute('href'),
    ).toBe('/declarations/0e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b');
    expect(
      within(row).getByRole('button', { name: 'Discard Biennial declaration 2027' }),
    ).toBeTruthy();
  });

  it('says when there are no declarations yet', () => {
    renderView(page([]));

    expect(screen.getByText('No declarations yet')).toBeTruthy();
    expect(screen.getByText('Start one from Home when it is due.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Home' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('says when the declarations could not be loaded', () => {
    renderView({ status: 'unavailable' });

    expect(screen.getByText('We could not load your declarations')).toBeTruthy();
  });
});

describe('paging', () => {
  const rows = [{ kind: 'filed' as const, declaration: filed() }];

  it('shows no pager while everything fits on the smallest page', () => {
    renderView(page(rows, { total: 5 }));

    expect(screen.queryByRole('navigation', { name: 'Pages of your declarations' })).toBeNull();
  });

  it('pages through the rest', () => {
    renderView(page(rows, { page: 2, total: 12 }));
    const pager = screen.getByRole('navigation', { name: 'Pages of your declarations' });

    expect(within(pager).getByText('6-10 of 12')).toBeTruthy();
    expect(within(pager).getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe(
      'page',
    );
    fireEvent.click(within(pager).getByRole('button', { name: 'Page 3' }));
    expect(onPage).toHaveBeenLastCalledWith(3);
    fireEvent.click(within(pager).getByRole('button', { name: 'Previous page' }));
    expect(onPage).toHaveBeenLastCalledWith(1);
    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenLastCalledWith(3);
  });

  it('cannot go past the first or the last page', () => {
    renderView(page(rows, { page: 3, total: 12 }));
    const pager = screen.getByRole('navigation', { name: 'Pages of your declarations' });

    expect(within(pager).getByText('11-12 of 12')).toBeTruthy();
    expect(
      within(pager).getByRole<HTMLButtonElement>('button', { name: 'Next page' }).disabled,
    ).toBe(true);
  });

  it('offers the first, the last and the pages around the current one', () => {
    expect(pageNumbers(1, 3)).toEqual([
      { page: 1, gap: false },
      { page: 2, gap: false },
      { page: 3, gap: false },
    ]);
    expect(
      pageNumbers(6, 12).map(({ page: number, gap }) => (gap ? `…${String(number)}` : number)),
    ).toEqual([1, '…5', 6, 7, '…12']);
  });
});

describe('amending (S7)', () => {
  function openAmend() {
    const row = renderFiled(filed());
    fireEvent.click(within(row).getByRole('button', { name: 'Amend Initial declaration' }));
    return screen.getByRole('dialog', { name: 'Amend version 1?' });
  }

  it('asks first, then reopens the version and opens it in the workspace', async () => {
    vi.mocked(amendMyDeclaration).mockResolvedValue({
      status: 'amending',
      declaration: {} as never,
    });
    const dialog = openAmend();
    expect(
      within(dialog).getByText(
        'Your submitted version stays in force until you submit the amendment.',
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText('Submit again by 2 Oct 2026. The reference number stays the same.'),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Amend version 1' }));
      await Promise.resolve();
    });

    expect(amendMyDeclaration).toHaveBeenCalledWith({ data: { declarationId: ID } });
    expect(navigate).toHaveBeenCalledWith({ to: '/declarations/$id', params: { id: ID } });
  });

  it('says amendments closed when the due date passed meanwhile (409)', async () => {
    vi.mocked(amendMyDeclaration).mockResolvedValue({
      status: 'conflict',
      code: 'amendment-window-closed',
    });
    const dialog = openAmend();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Amend version 1' }));
      await Promise.resolve();
    });

    expect(
      within(dialog).getByText('Amendments closed on 2 Oct 2026. Contact your Commission.'),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Amend version 1' }).disabled,
    ).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('offers a reload when the declaration changed elsewhere (409 not-submitted)', async () => {
    vi.mocked(amendMyDeclaration).mockResolvedValue({ status: 'conflict', code: 'not-submitted' });
    const dialog = openAmend();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Amend version 1' }));
      await Promise.resolve();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload' }));

    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open to try again when the service is down', async () => {
    vi.mocked(amendMyDeclaration).mockResolvedValue({ status: 'unavailable' });
    const dialog = openAmend();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Amend version 1' }));
      await Promise.resolve();
    });

    expect(
      within(dialog).getByText('We could not start the amendment. Try again in a few minutes.'),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Amend version 1' }).disabled,
    ).toBe(false);
  });
});

describe('discarding an amendment (S8)', () => {
  function openDiscard() {
    const row = renderFiled(
      filed({ status: 'amending', amendingFromVersion: 1, amendable: false }),
    );
    fireEvent.click(
      within(row).getByRole('button', { name: 'Discard amendment: Initial declaration' }),
    );
    return screen.getByRole('dialog', { name: 'Discard this amendment?' });
  }

  it('asks first, then keeps the submitted version and reloads the list', async () => {
    vi.mocked(discardMyAmendment).mockResolvedValue({
      status: 'discarded',
      declaration: {} as never,
    });
    const dialog = openDiscard();
    expect(
      within(dialog).getByText(
        'Your changes will be deleted. Version 1 stays in force, unchanged.',
      ),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Discard amendment' }));
      await Promise.resolve();
    });

    expect(discardMyAmendment).toHaveBeenCalledWith({ data: { declarationId: ID } });
    expect(invalidate).toHaveBeenCalled();
    expect(await screen.findByText('Amendment discarded. Version 1 is unchanged.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps amending on Keep amending', () => {
    const dialog = openDiscard();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep amending' }));

    expect(discardMyAmendment).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says when the amendment is no longer in progress, or the service is down', async () => {
    vi.mocked(discardMyAmendment).mockResolvedValueOnce({ status: 'not-amending' });
    const dialog = openDiscard();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Discard amendment' }));
      await Promise.resolve();
    });
    expect(
      within(dialog).getByText(
        'This declaration is no longer being amended. Reload to see where it stands.',
      ),
    ).toBeTruthy();

    vi.mocked(discardMyAmendment).mockResolvedValueOnce({ status: 'unavailable' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Discard amendment' }));
      await Promise.resolve();
    });
    expect(
      within(dialog).getByText('We could not discard the amendment. Try again in a few minutes.'),
    ).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
