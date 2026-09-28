import { ACTING_TENANT_HEADER, ServiceTokenClient, TokenVerifier } from '@adili/api-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CSV } from '../../src/uploads/purposes.js';
import type { UploadDownload, UploadReservation } from '../../src/uploads/representation.js';
import { type Caller, type DocumentsApi, startDocumentsApi } from '../support/documents-api.js';
import { fixture } from '../support/files.js';

/**
 * Spec 02 decision 2 end to end: the directory's client credentials token from the committed
 * realm (Keycloak at TEST_KEYCLOAK_ISSUER_URL) downloads a clean upload acting for its tenant.
 */
const ISSUER = process.env.TEST_KEYCLOAK_ISSUER_URL ?? '';
const OFFICER: Caller = { sub: 'officer-1', tenant: 'psc', roles: ['reporting-officer'] };

const directoryTokens = new ServiceTokenClient({
  issuerUrl: ISSUER,
  clientId: 'directory',
  clientSecret: 'directory-dev-secret',
});

let api: DocumentsApi;
let uploadId: string;

beforeAll(async () => {
  api = await startDocumentsApi({ keycloakIssuerUrl: ISSUER });
  const bytes = fixture('roster.csv');
  const reservation = (
    await api.post(
      '/v1/uploads',
      { purpose: 'roster-import', contentType: CSV, declaredSize: bytes.length },
      OFFICER,
    )
  ).json<UploadReservation>();
  await fetch(reservation.uploadUrl, {
    method: 'PUT',
    body: bytes,
    headers: { 'content-type': CSV },
  });
  await api.post(`/v1/uploads/${reservation.id}/complete`, undefined, OFFICER);
  uploadId = reservation.id;
});

afterAll(async () => {
  await api.close();
});

const downloadAs = async (token: string, tenant: string) =>
  api.app.inject({
    method: 'GET',
    url: `/internal/v1/uploads/${uploadId}/download`,
    headers: { authorization: `Bearer ${token}`, [ACTING_TENANT_HEADER]: tenant },
  });

describe('directory service token', () => {
  it('carries documents:internal and the adili-api audience, and no tenant', async () => {
    const principal = await new TokenVerifier(ISSUER, 'adili-api').verify(
      await directoryTokens.token(),
    );

    expect(principal).toMatchObject({ clientId: 'directory', tenant: null });
    expect(principal.scopes).toContain('documents:internal');
  });

  it('downloads a clean upload acting for its tenant, and nothing of another tenant', async () => {
    const token = await directoryTokens.token();

    const response = await downloadAs(token, 'psc');
    expect(response.statusCode).toBe(200);
    expect(response.json<UploadDownload>()).toMatchObject({ id: uploadId, state: 'clean' });

    expect((await downloadAs(token, 'tsc')).statusCode).toBe(404);
  });
});
