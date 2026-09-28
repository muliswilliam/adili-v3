/**
 * Writes the notifications service's contract, packages/schemas/internal/notifications.yaml: the
 * service's OpenAPI document (see `exportContract`). No later spec drafts an operation of it:
 * templates later specs need are added to `templates` in src/messages/templates.ts, which widens
 * the TemplateId enum. `--out <file>` writes it elsewhere, for the drift check
 * (`pnpm contracts:drift`).
 *
 *     pnpm --filter @adili/notifications contracts
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { exportContract } from '@adili/api-kit';

import { AppModule } from '../app.module.js';
import { SERVICE_DESCRIPTION, SERVICE_NAME } from '../config.js';
import { OPENAPI_SCHEMAS } from '../openapi.js';

const SCHEMAS_PACKAGE = new URL('../../../../packages/schemas/', import.meta.url);
const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
const outputFile =
  args.out ?? fileURLToPath(new URL('internal/notifications.yaml', SCHEMAS_PACKAGE));

await exportContract(AppModule, {
  name: SERVICE_NAME,
  description: SERVICE_DESCRIPTION,
  schemas: OPENAPI_SCHEMAS,
  outputFile,
});
console.log(`wrote ${outputFile}`);
