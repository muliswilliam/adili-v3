#!/usr/bin/env node
// Writes a service's internal contract, packages/schemas/internal/<service>.yaml: the service's
// OpenAPI document plus the drafted operations of later specs from
// packages/schemas/drafts/<service>.yaml (see `exportContract` in @adili/api-kit). `--out <file>`
// writes it elsewhere, for the drift check (check-drift.mjs).
//
// One script for every service with an internal API. It runs in the service's directory through
// the service's `contracts` script, which loads TypeScript and the service's .env.example:
//
//     "contracts": "node --disable-warning=DEP0205 --env-file=.env.example --import @swc-node/register/esm-register ../../packages/schemas/scripts/export-contract.mjs"
//
// and reads the layout every service shares: `AppModule` from src/app.module.ts,
// `SERVICE_NAME` and `SERVICE_DESCRIPTION` from src/config.ts, `OPENAPI_SCHEMAS` from
// src/openapi.ts.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const schemasPackage = join(dirname(fileURLToPath(import.meta.url)), '..');
const serviceDir = process.cwd();
const fromService = (file) => import(pathToFileURL(join(serviceDir, file)).href);

// api-kit as the service resolves it, so the export scans with the same instance the service uses.
const apiKit = createRequire(join(serviceDir, 'package.json')).resolve('@adili/api-kit');
const { exportContract } = await import(pathToFileURL(apiKit).href);
const { AppModule } = await fromService('src/app.module.ts');
const { SERVICE_NAME, SERVICE_DESCRIPTION } = await fromService('src/config.ts');
const { OPENAPI_SCHEMAS } = await fromService('src/openapi.ts');

const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
const outputFile = args.out ?? join(schemasPackage, 'internal', `${SERVICE_NAME}.yaml`);

await exportContract(AppModule, {
  name: SERVICE_NAME,
  description: SERVICE_DESCRIPTION,
  schemas: OPENAPI_SCHEMAS,
  draftFile: join(schemasPackage, 'drafts', `${SERVICE_NAME}.yaml`),
  outputFile,
});
console.log(`wrote ${outputFile}`);
