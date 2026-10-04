import 'reflect-metadata';

import { scanOpenApiDocument } from '@adili/api-kit';
import type {
  OpenAPIObject,
  OperationObject,
  PathItemObject,
  ResponseObject,
} from '@nestjs/swagger';
import { beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { SERVICE_DESCRIPTION, SERVICE_NAME } from '../src/config.js';
import { OPENAPI_SCHEMAS } from '../src/openapi.js';

const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;

interface Operation {
  method: string;
  path: string;
  operation: OperationObject;
}

function operationsOf(document: OpenAPIObject): Operation[] {
  return Object.entries<PathItemObject>(document.paths).flatMap(([path, item]) =>
    METHODS.flatMap((method) => {
      const operation = item[method];
      return operation ? [{ method, path, operation }] : [];
    }),
  );
}

/**
 * The reporting service's OpenAPI document as `pnpm --filter @adili/reporting contracts` exports
 * it to packages/schemas/internal/reporting.yaml, the contract the console's client is generated
 * from (#238).
 */
describe('the reporting contract', () => {
  let operations: Operation[];

  beforeAll(async () => {
    const document = await scanOpenApiDocument(AppModule, {
      name: SERVICE_NAME,
      description: SERVICE_DESCRIPTION,
      schemas: OPENAPI_SCHEMAS,
    });
    operations = operationsOf(document);
  });

  it('holds the spec 09 and 09b operations the service implements', () => {
    expect(operations.map(({ operation }) => operation.operationId).sort()).toEqual(
      [
        'approveNationalReport',
        'buildNationalReport',
        'buildOpenDataRelease',
        'compileComplianceReport',
        'confirmComplianceReport',
        'draftNationalReportNarrative',
        'getAiUsage',
        'getCommissionOpenDataPreview',
        'getComplianceReport',
        'getEaccIntake',
        'getNationalReport',
        'getNationalReportCandidates',
        'getOpenDataRelease',
        'getOpenDataTable',
        'getOpenDataTableCsv',
        'getSubmittedReport',
        'listComplianceReports',
        'listOpenDataReleases',
        'listOpenDataReleasesEacc',
        'listReferralIntake',
        'markReportReviewed',
        'publishOpenDataRelease',
        'pushReferralToIcms',
        'submitComplianceReport',
        'updateNationalReportNarrative',
        'updateReportManualFields',
        'updateReportRemarks',
        'withdrawOpenDataRelease',
      ].sort(),
    );
  });

  it('names the body every success answers with (JSON, or CSV for a table download), except compile (202, no body)', () => {
    const bare = operations.flatMap(({ method, path, operation }) =>
      Object.entries(operation.responses)
        .filter(([status]) => status.startsWith('2') && status !== '202')
        .filter(([, response]) => {
          const content = (response as ResponseObject).content;
          return !(content?.['application/json']?.schema ?? content?.['text/csv']?.schema);
        })
        .map(([status]) => `${method.toUpperCase()} ${path} ${status}`),
    );

    expect(bare).toEqual([]);
  });

  it('documents the body of every write that takes one', () => {
    const withBody = operations
      .filter(({ operation }) => operation.requestBody !== undefined)
      .map(({ operation }) => operation.operationId)
      .sort();

    expect(withBody).toEqual(
      [
        'buildOpenDataRelease',
        'confirmComplianceReport',
        'draftNationalReportNarrative',
        'markReportReviewed',
        'submitComplianceReport',
        'updateNationalReportNarrative',
        'updateReportManualFields',
        'updateReportRemarks',
        'withdrawOpenDataRelease',
      ].sort(),
    );
  });

  it('asks no token of the public open-data API, and answers it readable from any origin', () => {
    const open = operations.filter(({ path }) => path.startsWith('/open-data/'));
    expect(open.map(({ operation }) => operation.operationId).sort()).toEqual([
      'getOpenDataRelease',
      'getOpenDataTable',
      'getOpenDataTableCsv',
      'listOpenDataReleases',
    ]);
    for (const { operation } of open) {
      expect(operation.security).toEqual([]);
      for (const [status, response] of Object.entries(operation.responses)) {
        const headers = Object.keys((response as ResponseObject).headers ?? {});
        expect(headers, status).toContain('Access-Control-Allow-Origin');
        if (status === '200' || status === '304') {
          expect(headers, status).toEqual(
            expect.arrayContaining(['ETag', 'Last-Modified', 'Cache-Control']),
          );
        }
        if (status === '200' || status === '429') {
          expect(headers, status).toEqual(
            expect.arrayContaining(['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset']),
          );
        }
      }
    }
  });
});
