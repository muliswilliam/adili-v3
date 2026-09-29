import {
  type ClarificationPolicy,
  type CommissionFacts,
  DEFAULT_LADDER_POLICY,
  DirectoryClient,
  DirectoryUnavailable,
  type LadderPolicy,
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

/**
 * The directory's policies for tests: every Commission given has the platform defaults, and the
 * ladder windows spec 08 sets unless a test gives others.
 */
export class FakeDirectory extends DirectoryClient {
  private readonly policies = new Map<string, ClarificationPolicy>();
  private readonly ladders = new Map<string, LadderPolicy>();

  givenCommission(slug: string, policy: ClarificationPolicy = DEFAULT_CLARIFICATION_POLICY): void {
    this.policies.set(slug, policy);
  }

  givenLadderPolicy(slug: string, policy: Partial<LadderPolicy>): void {
    this.ladders.set(slug, { ...DEFAULT_LADDER_POLICY, ...policy });
  }

  reset(): void {
    this.policies.clear();
    this.ladders.clear();
  }

  getLadderPolicy(slug: string): Promise<LadderPolicy> {
    return this.policies.has(slug)
      ? Promise.resolve(this.ladders.get(slug) ?? DEFAULT_LADDER_POLICY)
      : Promise.reject(new DirectoryUnavailable(`No policy for ${slug}`));
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
