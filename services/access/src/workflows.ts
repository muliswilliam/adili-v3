/**
 * Every workflow the access worker hosts (ADR-003): the entry Temporal bundles into its
 * deterministic sandbox. Each module keeps its own `workflows.ts` next to its activities and is
 * re-exported here: `AccessRequestWorkflow` (requests, #253), `LeaRequestWorkflow` (lea, #264)
 * and `CertifiedCopyWorkflow` (self-access, #267).
 */
export { accessRequest } from './requests/workflows.js';
export { certifiedCopy } from './self-access/workflows.js';
