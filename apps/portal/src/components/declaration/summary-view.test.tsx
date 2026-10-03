// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSummaryHints } from '../../server/assistant';
import { discardMyDeclaration } from '../../server/declarations';
import type { LoadedSummary } from '../../server/declarations.server';
import type { CompletenessIssue } from '../../server/declarations/types';
import { SummaryView } from './summary-view';
import { PENDING_RETRY_MS } from './use-hints';
import {
  DECLARATION_ID,
  region as card,
  renderWorkspace,
  sampleDeclaration,
  sections,
} from './testing';
import { navigate } from './testing-mocks';

vi.mock('@tanstack/react-router', async () => {
  const base = (await import('./testing-mocks')).routerMock();
  return {
    ...base,
    // The summary's issue links carry `?errors=true`.
    Link: ({
      search,
      ...props
    }: { search?: Record<string, string>; children: ReactNode } & Record<string, unknown>) => {
      const link = base.Link(props as Parameters<typeof base.Link>[0]) as ReactElement<{
        href: string;
      }>;
      const query = search ? `?${new URLSearchParams(search).toString()}` : '';
      return cloneElement(link, { href: `${link.props.href}${query}` });
    },
  };
});
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());
vi.mock('../../server/submission', async () => (await import('./testing-mocks')).submissionMock());
vi.mock('../../server/step-up', async () => (await import('./testing-mocks')).stepUpMock());
vi.mock('../../server/assistant', async () => (await import('./testing-mocks')).assistantMock());

const discardMock = vi.mocked(discardMyDeclaration);
const hintsMock = vi.mocked(getSummaryHints);

const SPOUSE = 'spouse:5f0c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';
const CHILD = 'child:7b2e4d0a-3f4c-4e5d-9a6b-7c8d9e0f1a2b';
const ATTESTATION =
  'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.';

const COMPLETE_SECTIONS = sections(
  { bio: 'complete', household: 'complete', 'statement:officer': 'complete', other: 'complete' },
  [
    {
      key: `statement:${SPOUSE}`,
      completeness: 'complete',
      updatedAt: null,
      personName: 'Mary Wanjiru Kennedy',
    },
  ],
);

const MARY = { surname: 'Kennedy', firstName: 'Mary', otherNames: 'Wanjiru' };

const COMPLETE_DOCUMENT = {
  schemaVersion: 'declaration.v1',
  officer: {
    name: { surname: 'Kamau', firstName: 'Mwangi', otherNames: 'Njoroge' },
    birth: { date: '1980-04-02', place: 'Nyeri' },
    maritalStatus: 'married',
    maritalStatusChange: { changed: true, explanation: 'Married in April 2025.' },
    address: { postal: 'P.O. Box 12-10100, Nyeri', physical: 'Ruringu estate, Nyeri' },
    employment: {
      designation: 'Deputy Principal',
      employer: 'Nyeri High School',
      responsibleCommission: 'tsc',
      personnelFileNumber: 'TSC/999999',
      nature: 'permanent',
    },
  },
  spouses: {
    none: false,
    items: [
      {
        id: SPOUSE.slice(7),
        name: MARY,
        nationalId: '12345678',
        occupationSector: 'private',
        separated: false,
      },
    ],
  },
  children: { none: true, items: [] },
  statements: [
    {
      personKey: 'officer',
      personName: { surname: 'Kamau', firstName: 'Mwangi', otherNames: 'Njoroge' },
      statementDate: '2027-11-01',
      incomePeriod: { from: '2025-11-01', to: '2027-11-01' },
      incomeNil: false,
      income: [
        {
          id: 'a1',
          type: 'salary-emoluments',
          description: 'Salary from TSC',
          amount: { kesCents: 240_000_000 },
          location: { inKenya: true },
          change: { changed: false },
        },
      ],
      assetsNil: false,
      assets: [
        {
          id: 'a2',
          type: 'land',
          description: 'Plot in Kapsoya',
          value: { kesCents: 350_000_000 },
          joint: { isJoint: true, sharePercent: 50 },
          location: { inKenya: true },
          change: { changed: true, kind: 'acquisition', explanation: 'Bought in 2026.' },
          attachments: [
            { attachmentId: 'a1', uploadId: 'u1', fileName: 'title-deed.pdf', sha256: 'x' },
          ],
        },
      ],
      liabilitiesNil: true,
      liabilities: [],
    },
    {
      personKey: SPOUSE,
      personName: MARY,
      statementDate: '2027-11-01',
      incomePeriod: { from: '2025-11-01', to: '2027-11-01' },
      incomeNil: true,
      income: [],
      assetsNil: true,
      assets: [],
      liabilitiesNil: true,
      liabilities: [],
    },
  ],
  otherInformation: {
    materialChanges: [
      { personKey: 'officer', kind: 'marital-status', explanation: 'Married in April 2025.' },
      {
        personKey: 'officer',
        itemId: 'a2',
        itemDescription: 'Plot in Kapsoya',
        kind: 'acquisition',
        explanation: 'Bought in 2026.',
      },
    ],
    registrableInterests: {
      directorships: [{ company: 'Kapsoya Water Ltd', role: 'Director', remunerated: true }],
      memberships: [],
      dualCitizenship: { holds: false, pendingApplication: false },
      pendingCases: [],
    },
    freeText: '',
  },
  attestation: { text: ATTESTATION },
};

function summaryOf(overrides: Partial<LoadedSummary> = {}, declaration = {}): LoadedSummary {
  return {
    declaration: sampleDeclaration({
      sections: COMPLETE_SECTIONS,
      updatedAt: '2026-09-27T08:15:00Z',
      ...declaration,
    }),
    document: COMPLETE_DOCUMENT as unknown as LoadedSummary['document'],
    valid: true,
    blocking: [],
    canSubmit: false,
    cannotSubmitReason: 'before-statement-date',
    late: false,
    attestationText: ATTESTATION,
    ...overrides,
  };
}

function renderSummary(summary = summaryOf()) {
  return renderWorkspace(<SummaryView summary={summary} />, {
    step: 'summary',
    declaration: summary.declaration,
  });
}

function valueOf(scope: HTMLElement, term: string) {
  const dt = within(scope).getByText(term, { selector: 'dt' });
  return dt.nextElementSibling?.textContent;
}

function issue(sectionKey: string, message: string): CompletenessIssue {
  return { sectionKey, path: '/x', code: 'required', message };
}

beforeEach(() => {
  discardMock.mockReset();
  navigate.mockReset();
  hintsMock.mockReset();
  hintsMock.mockResolvedValue({ status: 'unavailable' });
});

describe('SummaryView', () => {
  it('renders a complete draft by paragraph, ready to check', () => {
    renderSummary();

    expect(screen.getByRole('heading', { level: 1, name: 'Summary' })).toBeTruthy();
    expect(screen.getByText('Everything is complete.')).toBeTruthy();
    for (const [title, paragraph] of [
      ['Name', 'Paragraph 1'],
      ['Date and place of birth', 'Paragraph 2'],
      ['Marital status', 'Paragraph 3'],
      ['Address', 'Paragraph 4'],
      ['Employment', 'Paragraph 5'],
      ['Spouses', 'Paragraph 6'],
      ['Dependent children', 'Paragraph 7'],
      ['Financial statements', 'Paragraph 8'],
      ['Other information', 'Paragraph 9'],
    ] as const) {
      expect(within(card(title)).getByText(paragraph)).toBeTruthy();
      expect(within(card(title)).getAllByText('Complete').length).toBeGreaterThan(0);
    }
  });

  it('shows your details one paragraph a card, each editing Your details', () => {
    renderSummary();

    expect(valueOf(card('Name'), 'Name')).toBe('Mwangi Njoroge Kamau');
    expect(valueOf(card('Date and place of birth'), 'Date of birth')).toBe('2 Apr 1980');
    expect(valueOf(card('Date and place of birth'), 'Place of birth')).toBe('Nyeri');
    expect(valueOf(card('Marital status'), 'Marital status')).toBe(
      'MarriedChanged since last declaration: Married in April 2025.',
    );
    const employment = card('Employment');
    expect(valueOf(employment, 'Reporting entity and designation')).toBe(
      'Nyeri High School · Deputy Principal',
    );
    expect(valueOf(employment, 'Nature of employment')).toBe('Permanent');
    expect(within(employment).queryByText('Job group')).toBeNull();
    expect(valueOf(employment, 'Responsible Commission')).toBe(
      'Teachers Service Commission · personnel file number TSC/999999',
    );
    for (const title of ['Name', 'Date and place of birth', 'Marital status', 'Address']) {
      expect(
        within(card(title))
          .getByRole('link', { name: `Edit ${title}` })
          .getAttribute('href'),
      ).toBe(`/declarations/${DECLARATION_ID}/bio`);
    }
  });

  it('S8: shows the HR fields the roster pre-filled', () => {
    const document = {
      ...COMPLETE_DOCUMENT,
      officer: {
        ...COMPLETE_DOCUMENT.officer,
        employment: {
          ...COMPLETE_DOCUMENT.officer.employment,
          jobGroup: 'D3 (T-Scale 13)',
          appointmentDate: '2026-09-02',
          workStation: 'Eldoret, Uasin Gishu',
        },
      },
    };
    renderSummary(summaryOf({ document: document as unknown as LoadedSummary['document'] }));

    const employment = card('Employment');
    expect(valueOf(employment, 'Job group')).toBe('D3 (T-Scale 13)');
    expect(valueOf(employment, 'Date of appointment')).toBe('2 Sep 2026');
    expect(valueOf(employment, 'Work station')).toBe('Eldoret, Uasin Gishu');
  });

  it('shows the household from the summary document', () => {
    renderSummary();

    expect(valueOf(card('Spouses'), 'Mary Wanjiru Kennedy')).toBe('ID 12345678 · Private sector');
    expect(
      within(card('Dependent children')).getByText('Declared: no dependent children under 18.'),
    ).toBeTruthy();
    expect(
      within(card('Spouses')).getByRole('link', { name: 'Edit Spouses' }).getAttribute('href'),
    ).toBe(`/declarations/${DECLARATION_ID}/household`);
  });

  it('shows each financial statement with totals, items and flags', () => {
    renderSummary();

    const statements = card('Financial statements');
    const totals = within(statements).getByRole('table', { name: 'Totals per person, KES' });
    expect(
      within(totals)
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual(['PersonIncomeAssetsLiabilities', 'You2,400,0003,500,0000', 'Mary000']);
    const assets = within(statements).getByRole('table', {
      name: 'You: Assets as at 1 Nov 2027, KES',
    });
    expect(within(assets).getByText('Joint, share 50% · Changed: acquired')).toBeTruthy();
    expect(within(assets).getByText('Documents: title-deed.pdf')).toBeTruthy();
    expect(within(statements).getAllByText('Income, 1 Nov 2025 to 1 Nov 2027')).toHaveLength(2);
    expect(within(statements).getAllByText('Nothing to declare.').length).toBe(4);
    expect(
      within(statements)
        .getByRole('link', { name: "Edit Mary Wanjiru Kennedy's financial statement" })
        .getAttribute('href'),
    ).toBe(`/declarations/${DECLARATION_ID}/statements/${encodeURIComponent(SPOUSE)}`);
  });

  it('S11: lists the items from registries or documents with their badges', () => {
    const at = '2026-09-26T08:00:00Z';
    const suggestionId = '7d1f7a64-3c41-4c55-9d0e-6a9b1b3e2f10';
    type Stated = (typeof COMPLETE_DOCUMENT.statements)[number];
    const [officer, spouse] = COMPLETE_DOCUMENT.statements as [Stated, Stated];
    const vehicle = {
      id: 'b1',
      type: 'vehicle',
      description: 'Toyota Probox',
      details: { registration: 'KCA 123A' },
      value: { kesCents: 85_000_000 },
      joint: { isJoint: false },
      location: { inKenya: true },
      change: { changed: false },
      source: { kind: 'ntsa', suggestionId, at },
    };
    const document = {
      ...COMPLETE_DOCUMENT,
      statements: [
        {
          ...officer,
          assets: officer.assets.map((asset) => ({
            ...asset,
            source: { kind: 'document', suggestionId, at },
          })),
        },
        { ...spouse, assetsNil: false, assets: [vehicle] },
      ],
    };
    renderSummary(summaryOf({ document: document as unknown as LoadedSummary['document'] }));

    const statements = card('Financial statements');
    const fold = within(statements).getByText('2 items from registries or documents');
    const list = within(fold.closest('details') as HTMLElement).getByRole('list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['DocumentPlot in Kapsoya · YouCheck', 'NTSAToyota Probox · MaryCheck']);
    expect(
      within(list).getByRole('img', { name: 'Source: From NTSA, 26 Sep 2026 · KCA 123A' }),
    ).toBeTruthy();
    expect(
      within(list).getByRole('link', { name: 'Check Toyota Probox' }).getAttribute('href'),
    ).toBe(`/declarations/${DECLARATION_ID}/statements/${encodeURIComponent(SPOUSE)}`);

    const assets = within(statements).getByRole('table', {
      name: 'You: Assets as at 1 Nov 2027, KES',
    });
    expect(
      within(assets).getByRole('img', {
        name: 'Source: Read from title-deed.pdf, 26 Sep 2026',
      }),
    ).toBeTruthy();
  });

  it('lists no sourced items when nothing came from a registry or document', () => {
    renderSummary();
    expect(screen.queryByText(/from registries or documents$/)).toBeNull();
  });

  it('renders paragraph 9 after the composed material changes', () => {
    renderSummary();

    const other = card('Other information');
    expect(
      within(other)
        .getAllByText(/./, { selector: 'dt' })
        .map((dt) => dt.textContent),
    ).toEqual([
      'Material changes',
      'Directorships',
      'Memberships',
      'Dual citizenship',
      'Pending cases',
      'Anything else',
    ]);
    expect(valueOf(other, 'Material changes')).toBe(
      'You · Marital status: marital status changed · Married in April 2025.' +
        'You · Plot in Kapsoya: acquired · Bought in 2026.',
    );
    expect(valueOf(other, 'Directorships')).toBe('Kapsoya Water Ltd, Director (paid)');
    expect(valueOf(other, 'Memberships')).toBe('None.');
    expect(valueOf(other, 'Dual citizenship')).toBe('No · pending application: no');
    expect(valueOf(other, 'Anything else')).toBe('Nothing added.');
  });

  it('shows the solemn declaration', () => {
    renderSummary();

    const solemn = card('Solemn declaration');
    expect(within(solemn).getByText(`"${ATTESTATION}"`)).toBeTruthy();
  });

  it('lists what blocks submission with links that show the errors', () => {
    const blocking = [
      issue('bio', 'Enter your date of birth.'),
      issue('household', 'Say whether you have a spouse to declare.'),
      issue('other', 'Say whether you hold another citizenship.'),
    ];
    renderSummary(
      summaryOf(
        { blocking, valid: false, cannotSubmitReason: 'incomplete' },
        {
          sections: sections({
            bio: 'incomplete',
            household: 'not-started',
            'statement:officer': 'complete',
            other: 'incomplete',
          }),
        },
      ),
    );

    const panel = card('3 things to complete before you can submit');
    expect(within(panel).getByRole('heading', { name: 'Your details' })).toBeTruthy();
    expect(
      within(panel).getByRole('link', { name: 'Enter your date of birth.' }).getAttribute('href'),
    ).toBe(`/declarations/${DECLARATION_ID}/bio?errors=true`);
    expect(
      within(panel)
        .getByRole('link', { name: 'Say whether you hold another citizenship.' })
        .getAttribute('href'),
    ).toBe(`/declarations/${DECLARATION_ID}/other?errors=true`);
    expect(screen.queryByText('Everything is complete.')).toBeNull();
    expect(within(card('Name')).getByText('Incomplete')).toBeTruthy();
    expect(within(card('Spouses')).getByText('Not started')).toBeTruthy();
    expect(screen.getByText('Complete the 3 items listed above to submit.')).toBeTruthy();
  });

  it('names the field of an issue the service words as a fragment ("is required")', () => {
    const blocking: CompletenessIssue[] = [
      { sectionKey: 'bio', path: '/birth/place', code: 'required', message: 'is required' },
      {
        sectionKey: 'household',
        path: '/spouses/items/0/separationDate',
        code: 'required',
        message: 'is required',
      },
    ];
    renderSummary(summaryOf({ blocking, valid: false, cannotSubmitReason: 'incomplete' }));

    const panel = card('2 things to complete before you can submit');
    expect(within(panel).getByRole('link', { name: 'Place of birth is required' })).toBeTruthy();
    expect(
      within(panel).getByRole('link', {
        name: 'Mary Wanjiru Kennedy: Date of separation is required',
      }),
    ).toBeTruthy();
    expect(within(panel).queryByRole('link', { name: 'is required' })).toBeNull();
  });

  it('shows at most twelve blocking issues and says how many more', () => {
    const blocking = Array.from({ length: 14 }, (_, index) =>
      issue('bio', `Issue ${String(index + 1)}.`),
    );
    renderSummary(summaryOf({ blocking, cannotSubmitReason: 'incomplete' }));

    const panel = card('14 things to complete before you can submit');
    expect(within(panel).getAllByRole('link')).toHaveLength(12);
    expect(within(panel).getByText('and 2 more')).toBeTruthy();
  });

  it('shows an empty draft as not answered yet', () => {
    renderSummary(
      summaryOf(
        {
          document: {
            officer: {},
            spouses: { none: false, items: [] },
            children: { none: false, items: [] },
            statements: [{ personKey: 'officer', personName: {} }],
            otherInformation: { materialChanges: [] },
          },
          blocking: [issue('bio', 'Enter your date of birth.')],
        },
        { sections: sections() },
      ),
    );

    expect(valueOf(card('Address'), 'Postal address')).toBe('Not answered');
    expect(valueOf(card('Date and place of birth'), 'Date of birth')).toBe('Not answered');
    expect(within(card('Spouses')).getByText('Not answered yet.')).toBeTruthy();
    expect(within(card('Dependent children')).getByText('Not answered yet.')).toBeTruthy();
    expect(within(card('Financial statements')).getAllByText('Not answered yet.')).toHaveLength(3);
    expect(valueOf(card('Other information'), 'Material changes')).toBe('None flagged.');
    expect(valueOf(card('Other information'), 'Dual citizenship')).toBe('Not answered');
    expect(within(card('Employment')).queryByText('-')).toBeNull();
  });

  it('shows a child not included at the statement date', () => {
    renderSummary(
      summaryOf({
        document: {
          ...COMPLETE_DOCUMENT,
          children: {
            none: false,
            items: [
              {
                id: CHILD.slice(6),
                name: { surname: 'Kamau', firstName: 'Wanjiku' },
                dateOfBirth: '2008-01-10',
                includedAtStatementDate: false,
              },
            ],
          },
        } as unknown as LoadedSummary['document'],
      }),
    );

    expect(valueOf(card('Dependent children'), 'Wanjiku Kamau')).toBe(
      'Born 10 Jan 2008 · Not included: 19 on the statement date',
    );
  });
});

describe('S20: Submit stays disabled with the reason', () => {
  function submit() {
    return screen.getByRole<HTMLButtonElement>('button', { name: 'Submit declaration' });
  }

  it('says when an upcoming obligation can be submitted', () => {
    renderSummary(summaryOf({ cannotSubmitReason: 'before-statement-date' }));

    expect(submit().disabled).toBe(true);
    const note = document.getElementById(submit().getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('Available from 1 Nov 2027');
  });

  it('says amendments closed on the due date', () => {
    renderSummary(
      summaryOf(
        { cannotSubmitReason: 'amendment-window-closed' },
        { status: 'amending', dueDate: '2027-12-31' },
      ),
    );

    expect(submit().disabled).toBe(true);
    const note = document.getElementById(submit().getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('Amendments closed on 31 Dec 2027. Contact your Commission.');
  });
});

describe('Discard from the summary', () => {
  it('confirms, discards and goes home', async () => {
    discardMock.mockResolvedValue({ status: 'discarded' });
    renderSummary();

    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    // The spec's copy, exactly: "Discard this draft? Everything you entered will be deleted."
    const dialog = screen.getByRole('dialog', { name: 'Discard this draft?' });
    expect(within(dialog).getByText('Everything you entered will be deleted.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
      await Promise.resolve();
    });

    expect(discardMock).toHaveBeenCalledWith({ data: { declarationId: DECLARATION_ID } });
    expect(navigate).toHaveBeenCalledWith({ to: '/', search: { discarded: true } });
  });

  it('shows the last saved time', () => {
    renderSummary();

    expect(screen.getByText('Last saved 27 Sep 2026, 11:15')).toBeTruthy();
  });
});

describe('S5: completeness hints on the summary', () => {
  const ADDRESS: CompletenessIssue = {
    sectionKey: 'bio',
    path: '/address/physical',
    code: 'required',
    message: 'Enter your physical address.',
  };
  const CITIZENSHIP: CompletenessIssue = {
    sectionKey: 'other',
    path: '/registrableInterests/dualCitizenship/pendingApplication',
    code: 'required',
    message: 'Say whether you have a pending citizenship application.',
  };
  const LABEL = {
    aiAssisted: true as const,
    task: 'answer-declarant-question' as const,
    promptVersion: 1,
    provider: 'anthropic',
    model: 'claude-opus-5',
    generatedAt: '2026-10-03T09:00:00Z',
    disclaimer: 'AI-assisted. Not legal advice.',
  };
  const HINT = 'Give the house, estate or road and the town where you live now.';

  function renderBlocked() {
    renderSummary(
      summaryOf({
        blocking: [ADDRESS, CITIZENSHIP],
        valid: false,
        cannotSubmitReason: 'incomplete',
      }),
    );
    return card('2 things to complete before you can submit');
  }

  it('shows a hint under each residual that has one, labelled AI-assisted, with Fix opening the field', async () => {
    hintsMock.mockResolvedValue({
      status: 'ok',
      hints: {
        status: 'ready',
        label: LABEL,
        residuals: [
          { ...ADDRESS, hint: HINT },
          { ...CITIZENSHIP, hint: null },
        ],
      },
    });
    const panel = renderBlocked();

    expect(await within(panel).findByText(HINT)).toBeTruthy();
    expect(hintsMock).toHaveBeenCalledWith({
      data: { declarationId: DECLARATION_ID, language: 'en' },
    });
    expect(within(panel).getByRole('img', { name: /^Hints: AI-assisted/ })).toBeTruthy();
    // The deterministic text stays, the hint beneath it, and Fix opens the field.
    expect(within(panel).getByText('Enter your physical address.')).toBeTruthy();
    expect(
      within(panel)
        .getByRole('link', { name: 'Fix: Enter your physical address.' })
        .getAttribute('href'),
    ).toBe(`/declarations/${DECLARATION_ID}/bio?field=%2Faddress%2Fphysical`);
    // A residual without a hint is the row it always was.
    expect(
      within(panel)
        .getByRole('link', { name: 'Say whether you have a pending citizenship application.' })
        .getAttribute('href'),
    ).toBe(`/declarations/${DECLARATION_ID}/other?errors=true`);
  });

  it('says hints are coming while they load, the rows as they were', () => {
    hintsMock.mockReturnValue(new Promise(() => undefined));
    const panel = renderBlocked();

    expect(within(panel).getByRole('status').textContent).toBe('Getting hints…');
    expect(
      within(panel)
        .getByRole('link', { name: 'Enter your physical address.' })
        .getAttribute('href'),
    ).toBe(`/declarations/${DECLARATION_ID}/bio?errors=true`);
  });

  it('leaves the rows unchanged without AI', async () => {
    hintsMock.mockResolvedValue({
      status: 'ok',
      hints: {
        status: 'unavailable',
        label: null,
        residuals: [
          { ...ADDRESS, hint: null },
          { ...CITIZENSHIP, hint: null },
        ],
      },
    });
    const panel = renderBlocked();

    await waitFor(() => {
      expect(within(panel).queryByRole('status')).toBeNull();
    });
    expect(within(panel).queryByRole('img', { name: /AI-assisted/ })).toBeNull();
    expect(within(panel).queryByRole('link', { name: /^Fix/ })).toBeNull();
    expect(within(panel).getAllByRole('link')).toHaveLength(2);
  });

  it('asks again while the hints are still being written', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      hintsMock
        .mockResolvedValueOnce({
          status: 'ok',
          hints: {
            status: 'pending',
            label: null,
            residuals: [
              { ...ADDRESS, hint: null },
              { ...CITIZENSHIP, hint: null },
            ],
          },
        })
        .mockResolvedValueOnce({
          status: 'ok',
          hints: {
            status: 'ready',
            label: LABEL,
            residuals: [
              { ...ADDRESS, hint: HINT },
              { ...CITIZENSHIP, hint: null },
            ],
          },
        });
      const panel = renderBlocked();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PENDING_RETRY_MS);
      });

      expect(await within(panel).findByText(HINT)).toBeTruthy();
      expect(hintsMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks for nothing when nothing is left to complete', () => {
    renderSummary();
    expect(hintsMock).not.toHaveBeenCalled();
  });
});
