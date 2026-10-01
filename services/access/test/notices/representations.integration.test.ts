import { randomUUID } from 'node:crypto';

import { DECLARANT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { representations } from '../../src/db/schema.js';
import type { DeclarantNotice } from '../../src/notices/representation.js';
import { accessRequestWorkflowId } from '../../src/requests/contract.js';
import type { OfficerRequestView } from '../../src/requests/officer-view.js';
import type { AccessRequest } from '../../src/requests/representation.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  callers,
  declarantOf,
  givenCommissions,
  notifiedRequest,
  resolve,
  rowOf,
  submitRequest,
} from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';
const NOTIFIED_AT = '2027-03-05T09:00:00.000Z';
const OBJECTION =
  'The assets in question were declared in full and the allocations predate my appointment.';

describe("The declarant's notices and representations (S4)", () => {
  let api: AccessApi;
  const { mercy, officer } = callers;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  /** Mercy's request about Anne, notified to Anne on 5 March: her window ends on 12 March. */
  async function notified() {
    const { anne } = givenCommissions(api, NOW);
    api.clock.set(NOTIFIED_AT);
    const row = await notifiedRequest(api, anne);
    return { anne, declarant: declarantOf(anne), row };
  }

  const respond = (requestId: string, caller: Caller, body: unknown) =>
    api.send('PUT', `/v1/me/access-notices/${requestId}/representations`, caller, body);

  const notices = (caller: Caller) => api.get('/v1/me/access-notices', caller);

  describe('notices', () => {
    it('S4: the declarant sees who asked, why and for what, and until when they may respond', async () => {
      const { declarant, row } = await notified();

      const response = await notices(declarant);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<DeclarantNotice[]>();
      expect(contractErrors(okResponse('/v1/me/access-notices', 'get'), body)).toEqual([]);
      expect(body).toEqual([
        {
          requestId: row.id,
          reference: row.reference,
          kind: 'form-k',
          commission: { slug: 'psc', name: 'Public Service Commission' },
          status: 'awaiting-representations',
          applicantName: 'Mercy Wanjiku Kamau',
          purposeInGeneralTerms:
            "Reporting on land allocations approved by the officer's department, where a conflict of interest has been alleged.",
          agency: null,
          caseReference: null,
          scope: {
            years: [2025, 2026],
            includeSpouses: true,
            includeChildren: false,
            sections: ['income', 'assets', 'liabilities'],
            includeClarifications: true,
          },
          notifiedAt: NOTIFIED_AT,
          windowEndsAt: '2027-03-12T09:00:00.000Z',
          canRespond: true,
          representations: null,
          decision: null,
        },
      ]);
    });

    it('shows nothing to another declarant, nor a request resolved to them before they are notified', async () => {
      const { anne } = givenCommissions(api, NOW);
      const other = api.directory.givenRosterRecord('psc', { fullName: 'John Otieno' });
      await notifiedRequest(api, anne);
      const { id } = await submitRequest(api);
      // Resolved, but its notice is not recorded yet: hold the workflow back.
      await api.endWorkflows([accessRequestWorkflowId(id)]);
      await resolve(api, id, other.id);

      expect((await notices(declarantOf(other))).json()).toEqual([]);
      expect((await notices(declarantOf(anne))).json<DeclarantNotice[]>()).toHaveLength(1);
      expect((await notices(mercy)).statusCode).toBe(403);
      expect((await notices({ sub: 'd', roles: [DECLARANT], tenant: 'psc' })).statusCode).toBe(404);
    });
  });

  describe('representations', () => {
    it('S4: the declarant objects with text and an attachment: recorded, registered, and shown to the officer', async () => {
      const { declarant, row, anne } = await notified();
      const upload = api.documents.givenUpload('psc', {
        uploadedBy: declarant.sub,
        fileName: 'title-deed.pdf',
      });
      api.clock.set('2027-03-07T10:00:00.000Z');

      const response = await respond(row.id, declarant, {
        stance: 'object',
        text: OBJECTION,
        attachments: [upload.id],
      });

      expect(response.statusCode, response.body).toBe(200);
      const notice = response.json<DeclarantNotice>();
      expect(
        contractErrors(
          okResponse('/v1/me/access-notices/{requestId}/representations', 'put'),
          notice,
        ),
      ).toEqual([]);
      expect(notice).toMatchObject({
        status: 'awaiting-representations',
        canRespond: true,
        representations: {
          stance: 'object',
          text: OBJECTION,
          attachments: [{ uploadId: upload.id, fileName: 'title-deed.pdf' }],
          submittedAt: '2027-03-07T10:00:00.000Z',
        },
      });
      expect(api.documents.linked).toEqual([upload.id]);

      const [event] = await api.events('access.request.representations.v1');
      expect(event).toMatchObject({
        subject: row.id,
        data: { kind: 'representations', personId: anne.personId, actor: declarant.sub },
      });
      expect(JSON.stringify(event)).not.toContain(OBJECTION);

      const view = (
        await api.get(`/v1/access/requests/${row.id}/officer`, officer)
      ).json<OfficerRequestView>();
      expect(view.representations).toMatchObject({ stance: 'object', text: OBJECTION });
      expect(view.timeline.map((entry) => entry.kind)).toEqual([
        'received',
        'notified',
        'representations',
      ]);
      // The applicant sees neither the representations nor that they were made.
      const mine = (await api.get(`/v1/access/requests/${row.id}`, mercy)).json<AccessRequest>();
      expect(mine.timeline.map((entry) => entry.kind)).toEqual(['received', 'notified']);
    });

    it('S4: the declarant edits them before the window ends; attachments taken off are released', async () => {
      const { declarant, row } = await notified();
      const first = api.documents.givenUpload('psc', { uploadedBy: declarant.sub });
      const second = api.documents.givenUpload('psc', { uploadedBy: declarant.sub });
      api.clock.set('2027-03-07T10:00:00.000Z');
      await respond(row.id, declarant, {
        stance: 'object',
        text: OBJECTION,
        attachments: [first.id],
      });
      api.clock.set('2027-03-11T10:00:00.000Z');

      const response = await respond(row.id, declarant, {
        stance: 'context',
        text: 'Further context.',
        attachments: [second.id],
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<DeclarantNotice>().representations).toMatchObject({
        stance: 'context',
        text: 'Further context.',
        attachments: [{ uploadId: second.id }],
        submittedAt: '2027-03-07T10:00:00.000Z',
      });
      expect(api.documents.unlinked).toEqual([first.id]);
      const stored = await api.asPlatform((tx) =>
        tx.select().from(representations).where(eq(representations.requestId, row.id)),
      );
      expect(stored).toHaveLength(1);
      expect(await api.events('access.request.representations.v1')).toHaveLength(2);
    });

    it('S4: after the window, 409 `representations-closed`', async () => {
      const { declarant, row } = await notified();
      api.clock.set('2027-03-12T09:00:00.000Z');

      const response = await respond(row.id, declarant, {
        stance: 'object',
        text: OBJECTION,
        attachments: [],
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'representations-closed' });
      expect((await notices(declarant)).json<DeclarantNotice[]>()[0]?.canRespond).toBe(false);
    });

    it('S4: consent moves the request under decision at once and closes the window', async () => {
      const { declarant, row } = await notified();

      const response = await respond(row.id, declarant, {
        stance: 'consent',
        text: '',
        attachments: [],
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<DeclarantNotice>()).toMatchObject({
        status: 'under-decision',
        canRespond: false,
        representations: { stance: 'consent', text: '' },
      });
      expect((await rowOf(api, row.id)).status).toBe('under-decision');
      const again = await respond(row.id, declarant, {
        stance: 'object',
        text: OBJECTION,
        attachments: [],
      });
      expect(again.statusCode).toBe(409);
      // The workflow is past the window, waiting for the decision.
      const workflow = api.temporal.workflow.getHandle(accessRequestWorkflowId(row.id));
      expect((await workflow.describe()).status.name).toBe('RUNNING');
    });

    it('refuses attachments that are not clean access-representation uploads of the declarant', async () => {
      const { declarant, row } = await notified();
      const infected = api.documents.givenUpload('psc', {
        uploadedBy: declarant.sub,
        clean: false,
      });
      const otherPurpose = api.documents.givenUpload('psc', {
        uploadedBy: declarant.sub,
        purpose: 'declaration-attachment',
      });
      const someoneElses = api.documents.givenUpload('psc', { uploadedBy: 'someone-else' });

      const response = await respond(row.id, declarant, {
        stance: 'object',
        text: OBJECTION,
        attachments: [infected.id, otherPurpose.id, someoneElses.id, randomUUID()],
      });

      expect(response.statusCode).toBe(400);
      expect(
        response.json<{ errors: { path: string }[] }>().errors.map((error) => error.path),
      ).toEqual(['attachments.0', 'attachments.1', 'attachments.2', 'attachments.3']);
      expect(api.documents.linked).toEqual([]);
      expect((await rowOf(api, row.id)).status).toBe('awaiting-representations');
    });

    it('answers 400 for an objection without text and for an attachment given twice', async () => {
      const { declarant, row } = await notified();
      const upload = api.documents.givenUpload('psc', { uploadedBy: declarant.sub });

      const noText = await respond(row.id, declarant, {
        stance: 'object',
        text: '  ',
        attachments: [],
      });
      const twice = await respond(row.id, declarant, {
        stance: 'context',
        text: 'Context.',
        attachments: [upload.id, upload.id],
      });

      expect(noText.statusCode).toBe(400);
      expect(noText.json()).toMatchObject({ errors: [{ path: 'text' }] });
      expect(twice.statusCode).toBe(400);
      expect(twice.json()).toMatchObject({ errors: [{ path: 'attachments.1' }] });
    });

    it('answers 503 when documents cannot be reached, and saves nothing', async () => {
      const { declarant, row } = await notified();
      const upload = api.documents.givenUpload('psc', { uploadedBy: declarant.sub });
      api.documents.failCalls(1);

      const response = await respond(row.id, declarant, {
        stance: 'object',
        text: OBJECTION,
        attachments: [upload.id],
      });

      expect(response.statusCode).toBe(503);
      const stored = await api.asPlatform((tx) => tx.select().from(representations));
      expect(stored).toEqual([]);
    });

    it('S4: the officer and the supervisor open an attachment of the representations; audited, and 404 for anything else', async () => {
      const { declarant, row, anne } = await notified();
      const upload = api.documents.givenUpload('psc', {
        uploadedBy: declarant.sub,
        fileName: 'title-deed.pdf',
      });
      const notAttached = api.documents.givenUpload('psc', { uploadedBy: declarant.sub });
      const saved = await respond(row.id, declarant, {
        stance: 'object',
        text: OBJECTION,
        attachments: [upload.id],
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const url = (uploadId: string) =>
        `/v1/access/requests/${row.id}/representations/attachments/${uploadId}/download`;

      const response = await api.get(url(upload.id), officer);
      const asSupervisor = await api.get(url(upload.id), callers.supervisor);

      expect(response.statusCode, response.body).toBe(200);
      expect(
        contractErrors(
          okResponse(
            '/v1/access/requests/{requestId}/representations/attachments/{uploadId}/download',
            'get',
          ),
          response.json(),
        ),
      ).toEqual([]);
      expect(response.json()).toEqual({
        downloadUrl: `https://files.test/uploads/${upload.id}`,
        expiresAt: '2030-01-01T00:00:00.000Z',
      });
      expect(asSupervisor.statusCode).toBe(200);
      const audits = await api.events('audit.read.v1');
      expect(audits).toHaveLength(2);
      expect(audits[0]).toMatchObject({
        tenant: 'psc',
        data: {
          action: 'access.representations.attachment.downloaded',
          resource: { type: 'access-request', subjectPersonId: anne.personId },
          actor: { subject: officer.sub },
        },
      });

      expect((await api.get(url(notAttached.id), officer)).statusCode).toBe(404);
      expect((await api.get(url(upload.id), callers.tscOfficer)).statusCode).toBe(404);
      expect((await api.get(url(upload.id), callers.eacc)).statusCode).toBe(404);
      expect((await api.get(url(upload.id), mercy)).statusCode).toBe(403);
      api.documents.failCalls(1);
      expect((await api.get(url(upload.id), officer)).statusCode).toBe(503);
    });

    it('answers 404 for a request about someone else, or one the declarant was not notified of', async () => {
      const { row } = await notified();
      const other = api.directory.givenRosterRecord('psc', { fullName: 'John Otieno' });
      const body = { stance: 'object', text: OBJECTION, attachments: [] };

      expect((await respond(row.id, declarantOf(other), body)).statusCode).toBe(404);
      expect((await respond(randomUUID(), declarantOf(other), body)).statusCode).toBe(404);
      expect((await respond(row.id, mercy, body)).statusCode).toBe(403);
    });
  });
});
