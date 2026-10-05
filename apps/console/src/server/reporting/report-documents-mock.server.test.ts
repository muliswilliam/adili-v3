import { EACC_ANALYST, EACC_TENANT, REPORTING_OFFICER } from '@adili/roles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { unsignedMockToken } from '../mock-http';
import { mockEaccIntake, setEaccIntakeMockLatency } from './eacc-mock.server';
import { resetReportingMock, setReportingMockLatency, submitMockReport } from './mock.server';
import { resetNcrMock } from './ncr-mock.server';
import { mockReportDocumentsFetch } from './report-documents-mock.server';

const TODAY = '2026-10-03';
const NCR_PDF = '0199b200-0000-7000-8000-000000000001';

function download(documentId: string, tenant: string = EACC_TENANT, role = EACC_ANALYST) {
  const token = unsignedMockToken({
    subject: 'mock-analyst',
    name: 'Baraka Mutua',
    roles: [role],
    tenant,
  });
  return mockReportDocumentsFetch(
    new Request(`http://documents.test/v1/documents/${documentId}/download`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
}

beforeAll(() => {
  setEaccIntakeMockLatency(0);
  setReportingMockLatency(0);
});

afterAll(() => {
  setEaccIntakeMockLatency(1);
  setReportingMockLatency(1);
});

beforeEach(() => {
  resetReportingMock(TODAY);
  resetNcrMock('approved');
});

describe("EACC's report documents under REPORTING_MOCK", () => {
  it('hands the national report PDF to the national report mock', async () => {
    const response = await download(NCR_PDF);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ downloadUrl: `/api/mock-files/${NCR_PDF}` });
  });

  it("hands a filed Form M's PDF to the intake mock", async () => {
    const filed = mockEaccIntake(2025).commissions.find((row) => row.formMDocumentId !== null);
    const id = filed?.formMDocumentId ?? '';

    const response = await download(id);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ downloadUrl: `/api/mock-files/${id}` });
  });

  it('answers 404 for a document neither mock knows, and to anyone outside EACC', async () => {
    expect((await download('0199c900-0000-7000-8000-202500000001')).status).toBe(404);
    expect((await download(NCR_PDF, 'psc')).status).toBe(404);
  });

  it("hands psc's PDF to EACC and to psc's officers alike, as the workspace issued it", async () => {
    submitMockReport(2025, '2026-07-28');
    const psc = mockEaccIntake(2025).commissions.find((row) => row.commission.slug === 'psc');
    const id = psc?.formMDocumentId ?? '';

    for (const response of [await download(id), await download(id, 'psc', REPORTING_OFFICER)]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ downloadUrl: `/api/mock-files/${id}` });
    }
    expect((await download(id, 'tsc', REPORTING_OFFICER)).status).toBe(404);
  });
});
