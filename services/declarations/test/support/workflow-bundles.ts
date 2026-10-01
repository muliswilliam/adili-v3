import { fileURLToPath } from 'node:url';

import { workflowBundlesSetup } from '@adili/temporal/testing';

// Bundles the worker's workflows once for the run; each file's app serves this bundle (see
// workflowBundlesSetup) instead of spending seconds of CPU bundling its own.
export default workflowBundlesSetup([
  fileURLToPath(new URL('../../src/obligations/workflow/workflows.ts', import.meta.url)),
]);
