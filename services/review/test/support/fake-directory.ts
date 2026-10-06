import {
  type ClarificationPolicy,
  type CommissionFacts,
  DEFAULT_LADDER_POLICY,
  DirectoryClient,
  DirectoryUnavailable,
  type LadderPolicy,
  type PayrollRosterFacts,
  type PreferredLanguage,
  type StaffMember,
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
 * ladder windows spec 08 sets unless a test gives others; and the roster records tests give, with
 * a record of each read of one (payroll's facts are read at send time).
 */
export class FakeDirectory extends DirectoryClient {
  readonly rosterReads: { tenant: string; recordId: string }[] = [];
  private readonly policies = new Map<string, ClarificationPolicy>();
  private readonly ladders = new Map<string, LadderPolicy>();
  private readonly rosters = new Map<string, PayrollRosterFacts>();
  private readonly staff = new Map<string, StaffMember[]>();
  private readonly languages = new Map<string, PreferredLanguage>();
  private languagesUnavailable = false;

  givenCommission(slug: string, policy: ClarificationPolicy = DEFAULT_CLARIFICATION_POLICY): void {
    this.policies.set(slug, policy);
  }

  givenLadderPolicy(slug: string, policy: Partial<LadderPolicy>): void {
    this.ladders.set(slug, { ...DEFAULT_LADDER_POLICY, ...policy });
  }

  /** A roster record of `tenant`, with the facts payroll needs. */
  givenRosterRecord(tenant: string, recordId: string, facts: PayrollRosterFacts): void {
    this.rosters.set(`${tenant}:${recordId}`, facts);
  }

  /** The Commission's staff holding `role`. */
  givenStaff(slug: string, role: 'reviewer' | 'supervisor', members: StaffMember[]): void {
    this.staff.set(`${slug}:${role}`, structuredClone(members));
  }

  /** The language the declarant chose (none by default). */
  givenPreferredLanguage(personId: string, language: PreferredLanguage): void {
    this.languages.set(personId, language);
  }

  /** Every read of a preferred language fails, as when the directory is down. */
  failPreferredLanguageReads(): void {
    this.languagesUnavailable = true;
  }

  getPreferredLanguage(slug: string, personId: string): Promise<PreferredLanguage | null> {
    if (this.languagesUnavailable || !this.policies.has(slug)) {
      return Promise.reject(new DirectoryUnavailable(`No Commission ${slug}`));
    }
    return Promise.resolve(this.languages.get(personId) ?? null);
  }

  listStaff(slug: string, role: 'reviewer' | 'supervisor'): Promise<StaffMember[]> {
    if (!this.policies.has(slug)) {
      return Promise.reject(new DirectoryUnavailable(`No Commission ${slug}`));
    }
    return Promise.resolve(structuredClone(this.staff.get(`${slug}:${role}`) ?? []));
  }

  reset(): void {
    this.staff.clear();
    this.languages.clear();
    this.languagesUnavailable = false;
    this.policies.clear();
    this.ladders.clear();
    this.rosters.clear();
    this.rosterReads.length = 0;
  }

  getRosterRecord(slug: string, recordId: string): Promise<PayrollRosterFacts | null> {
    if (!this.policies.has(slug)) {
      return Promise.reject(new DirectoryUnavailable(`No Commission ${slug}`));
    }
    this.rosterReads.push({ tenant: slug, recordId });
    return Promise.resolve(this.rosters.get(`${slug}:${recordId}`) ?? null);
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
