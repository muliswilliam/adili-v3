import type { components } from './schema.gen';

export type VerificationResult = components['schemas']['VerificationResult'];
export type VerificationStatus = components['schemas']['VerificationStatus'];
export type VerifiedDocument = NonNullable<VerificationResult['document']>;
export type ProblemDetails = components['schemas']['ProblemDetails'];
