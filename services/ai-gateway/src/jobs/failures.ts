/** Application failure types shared by the job activities and the workflow. */

/** Prefix of the failure type for a provider error, followed by its kind. */
export const PROVIDER_ERROR = 'ProviderError';
/** A provider timeout: the workflow records the job as failed with reason `timeout`. */
export const PROVIDER_TIMEOUT_ERROR = `${PROVIDER_ERROR}:timeout`;
