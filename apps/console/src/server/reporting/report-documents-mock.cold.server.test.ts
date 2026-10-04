import { EACC_ANALYST, EACC_TENANT } from '@adili/roles';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { unsignedMockToken } from '../mock-http';

/**
 * A cold dev server whose first reporting request is a document download: the national report's
 * PDF (`report-client.server.ts`) or a mock file (`/api/mock-files/$id`), with nothing having
 * loaded the Form M workspace mock (`mock.server.ts`) yet. The mocks seed themselves.
 */
/** The console's development environment, as a dev server reads it (`.env.example`). */
function stubDevelopmentEnv() {
  const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
  for (const line of example.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) vi.stubEnv(match[1], match[2]);
  }
}

const NCR_PDF = '0199b200-0000-7000-8000-000000000001';

const token = unsignedMockToken({
  subject: 'mock-analyst',
  name: 'Baraka Mutua',
  roles: [EACC_ANALYST],
  tenant: EACC_TENANT,
});

const downloadOf = (documentId: string) =>
  new Request(`http://documents.test/v1/documents/${documentId}/download`, {
    headers: { authorization: `Bearer ${token}` },
  });

describe('report documents on a cold start', () => {
  it('serves the approved national report PDF and a filed Form M without the workspace mock', async () => {
    vi.resetModules();
    stubDevelopmentEnv();
    vi.stubEnv('REPORTING_MOCK_NCR', 'approved');
    vi.stubEnv('REPORTING_MOCK_TODAY', '2026-10-03');
    try {
      const { mockReportDocumentsFetch } = await import('./report-documents-mock.server');
      const { mockNcrFileTitle } = await import('./ncr-mock.server');
      const { mockEaccIntake, mockReportingFileTitle, setEaccIntakeMockLatency } =
        await import('./eacc-mock.server');
      setEaccIntakeMockLatency(0);

      expect(mockNcrFileTitle(NCR_PDF)).toBe('NCR-EACC-2026-0000001-V.pdf');
      expect((await mockReportDocumentsFetch(downloadOf(NCR_PDF))).status).toBe(200);

      const filed = mockEaccIntake(2025).commissions.find((row) => row.formMDocumentId !== null);
      const formM = filed?.formMDocumentId ?? '';
      expect(mockReportingFileTitle(formM)).toMatch(/^Form M RPT-/);
      expect((await mockReportDocumentsFetch(downloadOf(formM))).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
