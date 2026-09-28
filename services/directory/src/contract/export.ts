/**
 * Writes the directory's contract, packages/schemas/internal/directory.yaml: the service's
 * OpenAPI document plus the drafted operations of later specs from
 * packages/schemas/drafts/directory.yaml (see `exportContract`). `--out <file>` writes it
 * elsewhere, for the drift check (`pnpm contracts:drift`).
 *
 *     pnpm --filter @adili/directory contracts
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { exportContract } from '@adili/api-kit';

import { AppModule } from '../app.module.js';
import { SERVICE_DESCRIPTION, SERVICE_NAME } from '../config.js';
import { OPENAPI_SCHEMAS } from '../openapi.js';

const SCHEMAS_PACKAGE = new URL('../../../../packages/schemas/', import.meta.url);
const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
const outputFile = args.out ?? fileURLToPath(new URL('internal/directory.yaml', SCHEMAS_PACKAGE));

await exportContract(AppModule, {
  name: SERVICE_NAME,
  description: SERVICE_DESCRIPTION,
  schemas: OPENAPI_SCHEMAS,
  draftFile: fileURLToPath(new URL('drafts/directory.yaml', SCHEMAS_PACKAGE)),
  outputFile,
});
console.log(`wrote ${outputFile}`);
