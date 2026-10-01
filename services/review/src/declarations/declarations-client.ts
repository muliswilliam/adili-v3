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
}
