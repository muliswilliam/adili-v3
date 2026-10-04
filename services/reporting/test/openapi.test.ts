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

  it('holds the spec 09 operations the service implements', () => {
    expect(operations.map(({ operation }) => operation.operationId).sort()).toEqual(
      [
        'approveNationalReport',
        'buildNationalReport',
        'compileComplianceReport',
        'confirmComplianceReport',
        'getAiUsage',
        'getComplianceReport',
        'getEaccIntake',
        'getNationalReport',
        'getSubmittedReport',
        'listComplianceReports',
        'listReferralIntake',
        'markReportReviewed',
        'pushReferralToIcms',
        'submitComplianceReport',
        'updateNationalReportNarrative',
        'updateReportManualFields',
        'updateReportRemarks',
      ].sort(),
    );
  });

  it('names the body every success answers with, except compile (202, no body)', () => {
    const bare = operations.flatMap(({ method, path, operation }) =>
      Object.entries(operation.responses)
        .filter(([status]) => status.startsWith('2') && status !== '202')
        .filter(
          ([, response]) => !(response as ResponseObject).content?.['application/json']?.schema,
        )
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
        'confirmComplianceReport',
        'markReportReviewed',
        'submitComplianceReport',
        'updateNationalReportNarrative',
        'updateReportManualFields',
        'updateReportRemarks',
      ].sort(),
    );
  });
});
