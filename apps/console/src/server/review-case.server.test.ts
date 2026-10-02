import { beforeEach, describe, expect, it } from 'vitest';

import {
  addNote,
  attachmentLink,
  claim,
  loadCaseView,
  markFlagReviewed,
  reassign,
  release,
} from './review-case.server';
import { MOCK_ATTACHMENTS, MOCK_FLAG_IDS as F } from './review/copilot-mock.server';
import {
  MOCK_CASE_IDS as CASES,
  MOCK_OFFICERS,
  mockReviewClient,
  resetReviewMock,
} from './review/mock.server';
import type { Assignee } from './review/types';

const NOW_MS = Date.parse('2026-10-02T09:00:00Z');
const ME: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Faith Achieng' };
const B: Assignee = { subject: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Halima Abdi' };

const as = (officer: Assignee) => mockReviewClient(officer.subject, officer.name);

async function view(caseId: string, officer: Assignee = ME) {
  const result = await loadCaseView(as(officer), caseId, officer);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
});

describe('loadCaseView (S9)', () => {
  it('returns the case with its document, flags, notes, timeline and reviewers of record', async () => {
    const { detail, documentUnavailable, viewer } = await view(CASES.mine);
    expect(documentUnavailable).toBe(false);
    expect(viewer).toEqual(ME);
    expect(detail.case.assignee).toEqual(ME);
    expect(detail.document?.schemaVersion).toBe('declaration.v1');
    expect(detail.flags).toHaveLength(5);
    expect(detail.notes.map((note) => note.author.name)).toEqual(['Peter Mwangi', ME.name]);
    expect(detail.reviewerHistory).toEqual([MOCK_OFFICERS.peter, ME]);
    expect(detail.versions.map((each) => each.version)).toEqual([1, 2]);
    expect(detail.timeline.at(0)?.kind).toBe('case-created');
    expect('determinations' in detail).toBe(false);
  });

  it('still shows the case when the declarations service is down (502)', async () => {
    const { detail, documentUnavailable } = await view(CASES.unavailable);
    expect(documentUnavailable).toBe(true);
    expect(detail.document).toBeNull();
    expect(detail.case.reference).toBe('DCB-TSC-2026-0000988-4');
    expect(detail.flags.length).toBeGreaterThan(0);
    expect(detail).not.toHaveProperty('title');
  });

  it('reads an unknown case as missing', async () => {
    const result = await loadCaseView(as(ME), 'ca5e0000-0000-4000-8000-0000000000ff', ME);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });
});

describe('assignment (S8)', () => {
  it('claims an unassigned case: assigned, a timeline entry and a reviewer of record', async () => {
    const claimed = await claim(as(ME), CASES.unassigned);
    expect(claimed).toMatchObject({ ok: true, data: { status: 'assigned', assignee: ME } });
    const { detail } = await view(CASES.unassigned);
    expect(detail.reviewerHistory).toEqual([ME]);
    expect(detail.timeline.at(-1)).toMatchObject({
      kind: 'assigned',
      summary: 'Claimed',
      ref: ME.subject,
    });
  });

  it('refuses a second claim (409), and only the holder releases (403 for anyone else)', async () => {
    await claim(as(ME), CASES.unassigned);
    expect(await claim(as(B), CASES.unassigned)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, type: 'case-already-assigned' } },
    });
    expect(await release(as(B), CASES.unassigned)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
    expect(await release(as(ME), CASES.unassigned)).toMatchObject({
      ok: true,
      data: { status: 'unassigned', assignee: null },
    });
  });

  it('loses a claim another officer made first, who then holds the case', async () => {
    expect(await claim(as(ME), CASES.contested)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409 } },
    });
    const { detail } = await view(CASES.contested);
    expect(detail.case.assignee).toEqual(MOCK_OFFICERS.mercy);
  });

  it('lets a supervisor reassign and unassign, keeping the history', async () => {
    expect(await reassign(as(ME), CASES.peters, MOCK_OFFICERS.mercy.subject)).toMatchObject({
      ok: true,
      data: { assignee: MOCK_OFFICERS.mercy },
    });
    expect(await reassign(as(ME), CASES.peters, null)).toMatchObject({
      ok: true,
      data: { assignee: null },
    });
    const { detail } = await view(CASES.peters);
    expect(detail.reviewerHistory).toEqual([MOCK_OFFICERS.mercy, MOCK_OFFICERS.peter]);
    expect(detail.timeline.slice(-2).map((entry) => entry.summary)).toEqual([
      'Reassigned to Mercy Wambui',
      'Unassigned by a supervisor',
    ]);
  });
});

describe('notes and flags', () => {
  it('adds an internal note, a timeline entry', async () => {
    const added = await addNote(as(ME), CASES.mine, 'Checked the title deed.');
    expect(added).toMatchObject({
      ok: true,
      data: { author: ME, text: 'Checked the title deed.' },
    });
    const { detail } = await view(CASES.mine);
    expect(detail.notes.at(-1)?.text).toBe('Checked the title deed.');
    expect(detail.timeline.at(-1)?.kind).toBe('note-added');
  });

  it('marks a flag reviewed once with a note, and the open count goes down (S11)', async () => {
    const before = (await view(CASES.mine)).detail.case.openFlags;
    const reviewed = await markFlagReviewed(as(ME), CASES.mine, F.acquisition, 'Bought in 2025.');
    expect(reviewed).toMatchObject({
      ok: true,
      data: { id: F.acquisition, reviewed: { by: ME, note: 'Bought in 2025.' } },
    });
    const { detail } = await view(CASES.mine);
    expect(detail.case.openFlags).toBe(before - 1);
    expect(detail.timeline.at(-1)).toMatchObject({ kind: 'flag-reviewed', ref: F.acquisition });
    expect(await markFlagReviewed(as(ME), CASES.mine, F.acquisition, 'Again.')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, type: 'flag-already-reviewed' } },
    });
  });

  it('gives a link to one of the declaration’s attachments, and 404 for any other upload', async () => {
    const link = await attachmentLink(as(ME), CASES.mine, MOCK_ATTACHMENTS.titleDeed.uploadId);
    expect(link.ok && link.data.downloadUrl).toBe(
      `/api/mock-files/${MOCK_ATTACHMENTS.titleDeed.uploadId}`,
    );
    expect(
      await attachmentLink(as(ME), CASES.mine, '0b10ad00-0000-4000-8000-0000000002ff'),
    ).toMatchObject({ ok: false, error: { kind: 'problem', problem: { status: 404 } } });
  });
});
