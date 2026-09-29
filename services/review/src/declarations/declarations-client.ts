/**
 * A submitted version as the declarations service's internal document endpoint gives it
 * (declarations.yaml `InternalVersionDocument`, `internalGetVersionDocument`): the decrypted
 * declaration.v1 document with its metadata. Content is used where it is pulled and never stored.
 */
export interface PulledVersion {
  declarationId: string;
  versionId: string;
  version: number;
  /** The declarant: the person whose earlier versions the rules compare against. */
  personId: string;
  /** The roster record of the obligation the version was filed for. */
  rosterRecordId: string;
  /** That roster record's reporting entity; null when it has none. */
  reportingEntityId: string | null;
  reference: string;
  type: 'initial' | 'biennial' | 'final';
  /** `YYYY-MM-DD`. */
  statementDate: string;
  submittedAt: string;
  late: boolean;
  /** The obligation's due date, `YYYY-MM-DD`. */
  dueDate: string;
  declarantName: string;
  personnelFileNumber: string;
  /** The immutable declaration.v1 document; validated by the caller before the rules read it. */
  document: Record<string, unknown>;
  attachments: {
    uploadId: string;
    itemId: string;
    personKey: string;
    fileName: string;
    sha256: string;
  }[];
}

/** The latest earlier submitted version of a person at a Commission (`internalFindPreviousVersion`). */
export interface PreviousVersionRef {
  declarationId: string;
  versionId: string;
  version: number;
  statementDate: string;
  submittedAt: string;
}

/**
 * A filing obligation as the declarations service's internal obligation endpoint gives it
 * (declarations.yaml `internalGetObligation`, spec 04): what the enforcement ladder is about and
 * whom it addresses. The name and file number are the roster's, for the Actions view and letters.
 */
export interface ObligationFacts {
  obligationId: string;
  rosterRecordId: string;
  /** Null until the officer onboards. */
  personId: string | null;
  type: 'initial' | 'biennial' | 'final';
  /** `initial:<appointment date>`, `biennial:<year>` or `final:<exit date>`. */
  cycleKey: string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  status: 'upcoming' | 'due' | 'overdue' | 'filed' | 'cancelled';
  declarantName: string;
  personnelFileNumber: string;
}

/**
 * One filing obligation of a person's history at a Commission, as the declarations service's
 * internal person obligation endpoint gives it (declarations.yaml `internalListPersonObligations`,
 * spec 08 BE-4): per cycle, its status and when it was filed. Facts only, no names.
 */
export interface PersonObligation {
  obligationId: string;
  type: 'initial' | 'biennial' | 'final';
  /** `initial:<appointment date>`, `biennial:<year>` or `final:<exit date>`. */
  cycleKey: string;
  status: 'upcoming' | 'due' | 'overdue' | 'filed' | 'cancelled';
  /** `YYYY-MM-DD`. */
  dueDate: string;
  /** ISO 8601; null while unfiled. */
  filedAt: string | null;
  late: boolean;
}

/**
 * On whose behalf content is read. The declarations service records every read as an audited
 * read naming the acting subject and, when there is one, the review case (ADR-008).
 */
export interface ReadContext {
  /** The Commission the read acts for. */
  tenant: string;
  /** A staff subject, or `system:review` for the processing workflow. */
  actingSubject: string;
  caseId?: string;
}

/**
 * The declarations service is unreachable, refused the service's token, or answered something
 * outside its contract. Workflow activities let it propagate so the pull is retried.
 */
export class DeclarationsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeclarationsUnavailable';
  }
}

/**
 * What the review service reads from the declarations service's internal API (spec 07a, #155),
 * one synchronous hop per read (ADR-013). A Nest token: the service uses
 * `HttpDeclarationsClient`, tests a fake.
 */
export abstract class DeclarationsClient {
  /** A submitted version with its document; null when the Commission has no such version. */
  abstract getVersionDocument(
    declarationId: string,
    version: number,
    context: ReadContext,
  ): Promise<PulledVersion | null>;

  /**
   * The person's latest submitted version at the Commission before `beforeVersionId`; null when
   * there is none (a first declaration on Adili).
   */
  abstract findPreviousVersion(
    personId: string,
    tenant: string,
    beforeVersionId: string,
  ): Promise<PreviousVersionRef | null>;

  /** A filing obligation of the Commission (spec 04); null when it has no such obligation. */
  abstract getObligation(obligationId: string, tenant: string): Promise<ObligationFacts | null>;

  /**
   * The person's filing obligations at the Commission across cycles (spec 08 BE-4, the referral
   * sweep); empty when the Commission has none of theirs.
   */
  abstract listPersonObligations(personId: string, tenant: string): Promise<PersonObligation[]>;
}
