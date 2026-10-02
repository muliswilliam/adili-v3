/**
 * Every workflow the access worker hosts (ADR-003): the entry Temporal bundles into its
 * deterministic sandbox. Each module keeps its own `workflows.ts` next to its activities and is
 * re-exported here: `AccessRequestWorkflow` (requests, #253), `LeaRequestWorkflow` (lea, #264)
 * `CertifiedCopyWorkflow` (self-access, #267) and `OnboardedNoticeWorkflow` (onboarded-notices,
 * spec 10 decision 2).
 */
export { leaRequest } from './lea/workflows.js';
export { onboardedNotice } from './onboarded-notices/workflows.js';
export { accessRequest } from './requests/workflows.js';
export { certifiedCopy } from './self-access/workflows.js';
