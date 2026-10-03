import { COMMISSION_ADMIN, REPORTING_OFFICER, SUPERVISOR } from '@adili/roles';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadReport } from './form-m.server';
import {
  confirmReport,
  documentLink,
  markReviewed,
  saveManualFields,
  saveRemarks,
} from './form-m-sign-off.server';
import {
  failNextReportingConfirms,
  mockReportingClient,
  mockReportingDocumentsClient,
  resetReportingMock,
  setReportingMockLatency,
} from './reporting/mock.server';

const supervisor = () => mockReportingClient([SUPERVISOR]);
const admin = () => mockReportingClient([COMMISSION_ADMIN], { name: 'Joyce Wanjiku' });

/** The first non-filer of section 2 in the mock's draft (Peter Mwangi Githinji). */
const PETER = '0199b000-0000-7000-8000-000000000201';

beforeAll(() => {
  setReportingMockLatency(0);
});
afterAll(() => {
  setReportingMockLatency(1);
});

async function report(fy = 2025) {
  const result = await loadReport(supervisor(), 'psc', fy);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

describe('the supervisor edits remarks (S3, S5)', () => {
  it('saves a remark by obligation id, and the draft reads it back', async () => {
    resetReportingMock('2026-10-03');
    const saved = await saveRemarks(supervisor(), 'psc', 2025, {
      [PETER]: 'Salary stopped from Aug 2026 payroll; officer on sick leave',
    });
    expect(saved.ok).toBe(true);
    const row = (await report()).document?.partII.biennial.nonFilers[0];
    expect(row?.remarks).toBe('Salary stopped from Aug 2026 payroll; officer on sick leave');
  });

  it('returns a blank remark to the latest action step label', async () => {
    resetReportingMock('2026-10-03');
    await saveRemarks(supervisor(), 'psc', 2025, { [PETER]: 'Edited' });
    await saveRemarks(supervisor(), 'psc', 2025, { [PETER]: '   ' });
    expect((await report()).document?.partII.biennial.nonFilers[0]?.remarks).toBe('Salary stopped');
  });

  it('refuses the commission-admin and the reporting officer (403)', async () => {
    resetReportingMock('2026-10-03');
    for (const client of [admin(), mockReportingClient([REPORTING_OFFICER])]) {
      expect(await saveRemarks(client, 'psc', 2025, { [PETER]: 'x' })).toMatchObject({
        ok: false,
        error: { kind: 'problem', problem: { status: 403 } },
      });
    }
  });

  it('refuses an officer the draft does not list (400 invalid-remarks)', async () => {
    resetReportingMock('2026-10-03');
    const result = await saveRemarks(supervisor(), 'psc', 2025, {
      '0199b000-0000-7000-8000-000000009999': 'x',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400, code: 'invalid-remarks' } },
    });
  });

  it('refuses edits to a submitted report (409 report-submitted)', async () => {
    resetReportingMock('2027-04-10');
    expect(await saveRemarks(supervisor(), 'psc', 2025, { [PETER]: 'x' })).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, code: 'report-submitted' } },
    });
  });
});

describe('the commission-admin fills Part I and Part B (S5)', () => {
  it('saves the contact details and the complaints, kept as given', async () => {
    resetReportingMock('2026-10-03');
    const saved = await saveManualFields(admin(), 'psc', 2025, {
      contactDetails: '+254 20 222 3901',
      emailAddress: 'compliance@publicservice.go.ke',
      complaintsRegisterMaintained: true,
      complaints: [
        {
          name: 'Jane Achieng',
          designation: 'Clerk',
          identifier: 'PSC/2020/0001',
          nature: 'Alleged undisclosed business interest',
          status: 'Under investigation',
        },
      ],
    });
    expect(saved.ok).toBe(true);
    const { partI, partII } = (await report()).document ?? {};
    expect(partI?.contactDetails).toBe('+254 20 222 3901');
    expect(partI?.physicalAddress).toBe('Commission House, Harambee Avenue, Nairobi');
    expect(partII?.complaints.registerMaintained).toBe(true);
    expect(partII?.complaints.items).toHaveLength(1);
  });

  it('clears a field given as null', async () => {
    resetReportingMock('2026-10-03');
    await saveManualFields(admin(), 'psc', 2025, { physicalAddress: null });
    expect((await report()).document?.partI.physicalAddress).toBe('');
  });

  it('refuses the supervisor (403)', async () => {
    resetReportingMock('2026-10-03');
    expect(
      await saveManualFields(supervisor(), 'psc', 2025, { contactDetails: 'x' }),
    ).toMatchObject({ ok: false, error: { kind: 'problem', problem: { status: 403 } } });
  });
});

describe('the supervisor marks the draft reviewed (S5)', () => {
  it('records Part III compiled-by with their name, the designation and today', async () => {
    resetReportingMock('2026-10-03');
    const result = await markReviewed(supervisor(), 'psc', 2025, 'Deputy Director, HRM');
    expect(result).toMatchObject({ ok: true });
    const reviewed = await report();
    expect(reviewed.status).toBe('reviewed');
    expect(reviewed.reviewedBy?.name).toBe('Samuel Njoroge');
    expect(reviewed.document?.partIII.compiledBy).toEqual({
      name: 'Samuel Njoroge',
      designation: 'Deputy Director, HRM',
      date: '2026-10-03',
    });
  });

  it('refuses the commission-admin (403)', async () => {
    resetReportingMock('2026-10-03');
    expect(await markReviewed(admin(), 'psc', 2025, 'Secretary')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });
});

describe('the commission-admin confirms with a step-up (S6, S7)', () => {
  const steppedUp = () =>
    mockReportingClient([COMMISSION_ADMIN], { name: 'Joyce Wanjiku', stepUpAt: Date.now() });
  const key = () => crypto.randomUUID();

  it('submits the reviewed, filled report with its RPT reference, late after 31 July', async () => {
    resetReportingMock('2026-10-03', { reviewed: true, filled: true });
    const answer = await confirmReport(steppedUp(), 'psc', 2025, key());
    expect(answer).toMatchObject({
      status: 'submitted',
      reference: 'RPT-PSC-2026-0000001-K',
      late: true,
    });
    const submitted = await report();
    expect(submitted.confirmedBy?.name).toBe('Joyce Wanjiku');
    expect(submitted.document?.partIII.confirmedBy.name).toBe('Joyce Wanjiku');
    expect(submitted.formMDocumentId).toBeNull();
  });

  it('submits on time by 31 July', async () => {
    resetReportingMock('2026-07-28', { reviewed: true, filled: true });
    expect(await confirmReport(steppedUp(), 'psc', 2025, key())).toMatchObject({
      status: 'submitted',
      late: false,
    });
  });

  it('answers the same to a replay of the key', async () => {
    resetReportingMock('2026-10-03', { reviewed: true, filled: true });
    const same = key();
    const first = await confirmReport(steppedUp(), 'psc', 2025, same);
    expect(await confirmReport(steppedUp(), 'psc', 2025, same)).toEqual(first);
  });

  it('asks for a step-up without one, or one older than five minutes (403)', async () => {
    resetReportingMock('2026-10-03', { reviewed: true, filled: true });
    expect(await confirmReport(admin(), 'psc', 2025, key())).toEqual({
      status: 'step-up-required',
    });
    const stale = mockReportingClient([COMMISSION_ADMIN], { stepUpAt: Date.now() - 6 * 60_000 });
    expect(await confirmReport(stale, 'psc', 2025, key())).toEqual({ status: 'step-up-required' });
  });

  it('refuses the supervisor (403), as forbidden', async () => {
    resetReportingMock('2026-10-03', { reviewed: true, filled: true });
    const client = mockReportingClient([SUPERVISOR], { stepUpAt: Date.now() });
    expect(await confirmReport(client, 'psc', 2025, key())).toEqual({ status: 'forbidden' });
  });

  it('refuses a draft not reviewed, and one with Part I or Part B to fill (400)', async () => {
    resetReportingMock('2026-10-03', { filled: true });
    expect(await confirmReport(steppedUp(), 'psc', 2025, key())).toEqual({
      status: 'not-reviewed',
    });
    resetReportingMock('2026-10-03', { reviewed: true });
    expect(await confirmReport(steppedUp(), 'psc', 2025, key())).toEqual({
      status: 'incomplete',
      paths: ['partI.contactDetails', 'partI.emailAddress', 'partII.complaints.registerMaintained'],
    });
  });

  it('says when the report was submitted already (409), as on a second confirm', async () => {
    resetReportingMock('2026-10-03', { reviewed: true, filled: true });
    await confirmReport(steppedUp(), 'psc', 2025, key());
    expect(await confirmReport(steppedUp(), 'psc', 2025, key())).toEqual({
      status: 'already-submitted',
    });
  });

  it('answers unavailable when the service fails, so the same key can be sent again', async () => {
    resetReportingMock('2026-10-03', { reviewed: true, filled: true });
    failNextReportingConfirms();
    const same = key();
    expect(await confirmReport(steppedUp(), 'psc', 2025, same)).toEqual({
      status: 'unavailable',
    });
    expect(await confirmReport(steppedUp(), 'psc', 2025, same)).toMatchObject({
      status: 'submitted',
    });
  });
});

describe("the submitted report's PDF and receipt", () => {
  it('are being issued right after confirmation, then download by a short-lived link', async () => {
    resetReportingMock('2026-10-03', { reviewed: true, filled: true });
    setReportingMockLatency(0, { issueMs: 0 });
    await confirmReport(
      mockReportingClient([COMMISSION_ADMIN], { stepUpAt: Date.now() }),
      'psc',
      2025,
      crypto.randomUUID(),
    );
    const issued = await report();
    setReportingMockLatency(0);
    expect(issued.formMDocumentId).not.toBeNull();
    const documents = mockReportingDocumentsClient([REPORTING_OFFICER]);
    for (const id of [issued.formMDocumentId, issued.receiptDocumentId]) {
      const link = await documentLink(documents, id ?? '');
      expect(link).toMatchObject({
        ok: true,
        data: { downloadUrl: `/api/mock-files/${id ?? ''}` },
      });
    }
  });

  it('are not found for staff of another Commission', async () => {
    resetReportingMock('2027-04-10');
    const id = (await report()).formMDocumentId ?? '';
    expect(await documentLink(mockReportingDocumentsClient([SUPERVISOR], 'tsc'), id)).toMatchObject(
      {
        ok: false,
        error: { kind: 'problem', problem: { status: 404 } },
      },
    );
  });
});
