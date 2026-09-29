import {
  type ClarificationPolicy,
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
} from '../../src/directory/directory-client.js';

/** The platform defaults: six months to request clarification, thirty days to answer. */
export const DEFAULT_CLARIFICATION_POLICY: ClarificationPolicy = {
  issueWindowMonths: 6,
  replyWindowDays: 30,
};

/** Names of the Commissions tests use. */
const NAMES: Record<string, string> = {
  psc: 'Public Service Commission',
  tsc: 'Teachers Service Commission',
};

/** The directory's policies for tests: every Commission given has the platform defaults. */
export class FakeDirectory extends DirectoryClient {
  private readonly policies = new Map<string, ClarificationPolicy>();

  givenCommission(slug: string, policy: ClarificationPolicy = DEFAULT_CLARIFICATION_POLICY): void {
    this.policies.set(slug, policy);
  }

  reset(): void {
    this.policies.clear();
  }

  getClarificationPolicy(slug: string): Promise<ClarificationPolicy> {
    const policy = this.policies.get(slug);
    return policy
      ? Promise.resolve(policy)
      : Promise.reject(new DirectoryUnavailable(`No policy for ${slug}`));
  }

  getCommission(slug: string): Promise<CommissionFacts> {
    return this.policies.has(slug)
      ? Promise.resolve({
          slug,
          issuerCode: slug.toUpperCase(),
          name: NAMES[slug] ?? `${slug.toUpperCase()} Commission`,
        })
      : Promise.reject(new DirectoryUnavailable(`No Commission ${slug}`));
  }
}
