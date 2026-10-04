import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import { CASE_ID, ME as FIXTURE_ME, registryView, WAFULA } from '../review-case/fixtures';

import {
  addNote,
  attachmentLink,
  claim,
  loadCaseView,
  loadComparison,
  markFlagReviewed,
  reassign,
  release,
  loadRegistry,
  loadRegistryStatus,
  loadReviewers,
  recheck,
} from './review-case.server';
import { MOCK_ATTACHMENTS, MOCK_FLAG_IDS as F } from './review/copilot-mock.server';
import {
  MOCK_CASE_IDS as CASES,
  MOCK_OFFICERS,
  mockReviewClient,
  resetReviewMock,
} from './review/mock.server';
import type { paths } from './review/api.gen';
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

type Handler = (request: Request) => Response | Promise<Response>;

function client(handler: Handler) {
  return createClient<paths>({
    baseUrl: 'http://review.test',
    fetch: (input) => Promise.resolve(handler(input)),
  });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

describe('loadReviewers', () => {
  const list = (items: unknown[]) => () => json(200, { items });

  it("lists the Commission's reviewers with their open cases, marking the reviewers of record", async () => {
    const paths: string[] = [];
    const result = await loadReviewers(
      client((request) => {
        paths.push(new URL(request.url).pathname);
        return list([
          { subject: FIXTURE_ME.subject, name: 'Kiprono Chebet', supervisor: true, openCases: 0 },
          { subject: 'old', name: 'Mercy Wambui', supervisor: false, openCases: 1 },
          { subject: WAFULA.subject, name: 'Wafula Barasa', supervisor: false, openCases: 2 },
        ])();
      }),
      'psc',
      { assignee: null, reviewerHistory: [{ subject: 'old', name: 'Mercy Wambui' }] },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    // One read, not one per status.
    expect(paths).toEqual(['/v1/commissions/psc/review/queue/reviewers']);
    expect(result.data).toEqual([
      { subject: FIXTURE_ME.subject, name: 'Kiprono Chebet', open: 0, ofRecord: false },
      { subject: 'old', name: 'Mercy Wambui', open: 1, ofRecord: true },
      { subject: WAFULA.subject, name: 'Wafula Barasa', open: 2, ofRecord: false },
    ]);
  });

  it('leaves out the reviewer holding the case', async () => {
    const result = await loadReviewers(
      client(
        list([
          { subject: WAFULA.subject, name: 'Wafula Barasa', supervisor: false, openCases: 1 },
          { subject: FIXTURE_ME.subject, name: 'Achieng Njeri', supervisor: true, openCases: 0 },
        ]),
      ),
      'psc',
      { assignee: WAFULA.subject, reviewerHistory: [WAFULA] },
    );
    expect(result.ok && result.data.map((each) => each.name)).toEqual(['Achieng Njeri']);
  });

  it('fails when the reviewers cannot be read', async () => {
    const result = await loadReviewers(
      client(() =>
        json(502, {
          type: 'directory-unavailable',
          title: 'Upstream service unavailable',
          status: 502,
        }),
      ),
      'psc',
      { assignee: null, reviewerHistory: [] },
    );
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});

describe('loadRegistry', () => {
  it('reads the Registry tab of the case', async () => {
    const urls: string[] = [];
    const result = await loadRegistry(
      client((request) => {
        urls.push(new URL(request.url).pathname);
        return json(200, registryView());
      }),
      CASE_ID,
    );
    expect(urls).toEqual([`/v1/review/cases/${CASE_ID}/registry`]);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.persons.map((person) => person.personName)).toEqual([
      'Wanjiku Njoki Kamau',
      'Imani Wairimu Kamau',
    ]);
  });

  it('passes on a gateway that could not give the records (502)', async () => {
    const result = await loadRegistry(
      client(() =>
        json(502, {
          type: 'integration-gateway-unavailable',
          title: 'Upstream service unavailable',
          status: 502,
        }),
      ),
      CASE_ID,
    );
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});

describe('loadRegistryStatus', () => {
  it("reads when the case's latest check was stored, off the audited registry view", async () => {
    const urls: string[] = [];
    const result = await loadRegistryStatus(
      client((request) => {
        urls.push(new URL(request.url).pathname);
        return json(200, { checkedAt: '2026-10-02T09:01:00.000Z' });
      }),
      CASE_ID,
    );
    expect(urls).toEqual([`/v1/review/cases/${CASE_ID}/registry/status`]);
    expect(result).toEqual({ ok: true, data: { checkedAt: '2026-10-02T09:01:00.000Z' } });
  });
});

describe('recheck', () => {
  const problem = (status: number, type: string, extra: Record<string, unknown> = {}) =>
    json(status, { type, title: type, status, ...extra });

  it('starts a re-check (202)', async () => {
    const methods: string[] = [];
    const result = await recheck(
      client((request) => {
        methods.push(`${request.method} ${new URL(request.url).pathname}`);
        return new Response(null, { status: 202 });
      }),
      CASE_ID,
    );
    expect(methods).toEqual([`POST /v1/review/cases/${CASE_ID}/recheck`]);
    expect(result).toEqual({ ok: true });
  });

  it('says how long the cooldown lasts (429)', async () => {
    expect(
      await recheck(
        client(() => problem(429, 'recheck-cooldown', { retryAfterSeconds: 420 })),
        CASE_ID,
      ),
    ).toEqual({ ok: false, refusal: { kind: 'cooldown', retryAfterSeconds: 420 } });
    // Without the field, the contract's ten minutes.
    expect(
      await recheck(
        client(() => problem(429, 'recheck-cooldown')),
        CASE_ID,
      ),
    ).toEqual({
      ok: false,
      refusal: { kind: 'cooldown', retryAfterSeconds: 600 },
    });
  });

  it('tells a reviewer who is not the assignee (403) from a determined case (409)', async () => {
    expect(
      await recheck(
        client(() => problem(403, 'not-the-assignee')),
        CASE_ID,
      ),
    ).toEqual({
      ok: false,
      refusal: { kind: 'forbidden' },
    });
    expect(
      await recheck(
        client(() => problem(409, 'case-closed')),
        CASE_ID,
      ),
    ).toEqual({
      ok: false,
      refusal: { kind: 'closed' },
    });
  });

  it('passes on anything else as a service error', async () => {
    expect(
      await recheck(
        client(() => problem(503, 'temporal-unavailable')),
        CASE_ID,
      ),
    ).toMatchObject({ ok: false, refusal: null, error: { kind: 'unavailable' } });
  });
});

describe('loadComparison (S10)', () => {
  it('returns matched items with deltas and the items in one version only', async () => {
    const result = await loadComparison(as(ME), CASES.mine);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const comparison = result.data;
    if (!comparison) throw new Error('expected a comparison');
    expect([comparison.previousVersion, comparison.currentVersion]).toEqual([1, 2]);
    const officer = comparison.statements[0];
    expect(officer?.personName).toBe('John Kennedy Otieno');
    const plot = officer?.matched.find((item) => item.type === 'land');
    expect(plot).toMatchObject({
      previousCents: 180_000_000,
      currentCents: 450_000_000,
      deltaCents: 270_000_000,
      deltaPercent: 150,
      flaggedByDeclarant: false,
    });
    expect(officer?.onlyCurrent.map((item) => item.description)).toContain(
      'CIC Money Market Fund units',
    );
    expect(officer?.onlyPrevious.map((item) => item.description)).toEqual([
      'Toyota Probox KCA 123X',
    ]);
  });

  it('is null when there is no previous version to compare with (409)', async () => {
    const result = await loadComparison(as(ME), CASES.unassigned);
    expect(result).toEqual({ ok: true, data: null });
  });

  it('fails as unavailable when the declarations service is down (502)', async () => {
    const result = await loadComparison(as(ME), CASES.unavailable);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unavailable');
  });

  it('reads another case as missing (404)', async () => {
    const result = await loadComparison(as(ME), 'ca5e0000-0000-4000-8000-0000000000ff');
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({ kind: 'problem', problem: { status: 404 } });
  });
});
