import createClient from 'openapi-fetch';
import { describe, expect, it } from 'vitest';

import { CASE_ID, caseData, DOCUMENT, ME, registryView, WAFULA } from '../review-case/fixtures';
import {
  claim,
  loadCase,
  loadReviewers,
  loadRegistry,
  loadRegistryStatus,
  recheck,
} from './review-case.server';
import type { paths } from './review/api.gen';

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

const detail = { ...caseData(), document: DOCUMENT };

describe('loadCase', () => {
  it('splits the case from its declaration as filed', async () => {
    const result = await loadCase(
      client(() => json(200, detail)),
      CASE_ID,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.document?.officer.name.firstName).toBe('Wanjiku');
    expect(result.data.documentUnavailable).toBe(false);
    expect(result.data.detail.flags).toHaveLength(3);
    expect('document' in result.data.detail).toBe(false);
  });

  it('keeps the case when declarations could not give the document (502)', async () => {
    const result = await loadCase(
      client(() =>
        json(502, {
          type: 'declarations-unavailable',
          title: 'Upstream service unavailable',
          status: 502,
          ...caseData(),
          document: null,
        }),
      ),
      CASE_ID,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.document).toBeNull();
    expect(result.data.documentUnavailable).toBe(true);
    expect(result.data.detail.case.reference).toBe('DCI-PSC-2026-9164002-3');
  });

  it('treats a document it cannot read as unavailable', async () => {
    const result = await loadCase(
      client(() => json(200, { ...detail, document: { schemaVersion: 'declaration.v0' } })),
      CASE_ID,
    );
    expect(result).toMatchObject({ ok: true, data: { document: null, documentUnavailable: true } });
  });

  it('passes on a missing case and a service that did not answer', async () => {
    expect(
      await loadCase(
        client(() => json(404, { type: 'about:blank', title: 'Not found', status: 404 })),
        CASE_ID,
      ),
    ).toMatchObject({ ok: false, error: { kind: 'problem', problem: { status: 404 } } });
    expect(
      await loadCase(
        client(() => json(503, { type: 'about:blank', title: 'Unavailable', status: 503 })),
        CASE_ID,
      ),
    ).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});

describe('claim', () => {
  it('says when another officer got there first', async () => {
    const result = await claim(
      client(() =>
        json(409, { type: 'case-already-assigned', title: 'Case already assigned', status: 409 }),
      ),
      CASE_ID,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 409, type: 'case-already-assigned' } },
    });
  });
});

describe('loadReviewers', () => {
  const list = (items: unknown[]) => () => json(200, { items });

  it("lists the Commission's reviewers with their open cases, marking the reviewers of record", async () => {
    const paths: string[] = [];
    const result = await loadReviewers(
      client((request) => {
        paths.push(new URL(request.url).pathname);
        return list([
          { subject: ME.subject, name: 'Kiprono Chebet', supervisor: true, openCases: 0 },
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
      { subject: ME.subject, name: 'Kiprono Chebet', open: 0, ofRecord: false },
      { subject: 'old', name: 'Mercy Wambui', open: 1, ofRecord: true },
      { subject: WAFULA.subject, name: 'Wafula Barasa', open: 2, ofRecord: false },
    ]);
  });

  it('leaves out the reviewer holding the case', async () => {
    const result = await loadReviewers(
      client(
        list([
          { subject: WAFULA.subject, name: 'Wafula Barasa', supervisor: false, openCases: 1 },
          { subject: ME.subject, name: 'Achieng Njeri', supervisor: true, openCases: 0 },
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
