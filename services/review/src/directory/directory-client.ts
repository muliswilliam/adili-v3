/**
 * The clarification periods of a Commission's policy in force (directory.yaml
 * `TenantPolicyVersion.clarification`, Act s.35).
 */
export interface ClarificationPolicy {
  /** How long after receipt the Commission may request clarification. */
  issueWindowMonths: number;
  /** How long the declarant has to respond. */
  replyWindowDays: number;
}

/** The directory is unreachable or answered outside its contract; activities retry. */
export class DirectoryUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DirectoryUnavailable';
  }
}

/**
 * What the review service reads from the directory's internal API. A Nest token: the service
 * uses `HttpDirectoryClient` behind a cache, tests a fake.
 */
export abstract class DirectoryClient {
  /** The Commission's clarification periods; throws `DirectoryUnavailable` for no policy. */
  abstract getClarificationPolicy(slug: string): Promise<ClarificationPolicy>;
}
