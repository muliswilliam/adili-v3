import { orderDeclarations, pageOf, type PageSize } from '../declaration/my-declarations';
import type { DeclarationsClient } from './declarations/client.server';
import type { Declaration, DeclarationListItem, DeclarationVersion } from './declarations/types';
import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * "My declarations" (spec 06 FE-4) on the declarations service: the declarant's declarations a
 * page at a time, a declaration's versions, and amending (amend, discard amendment). Pure: the
 * caller injects the client (see `my-declarations.ts` and `declarations.ts` for the server
 * functions).
 */

type Acknowledgement = NonNullable<DeclarationListItem['acknowledgement']>;

/** A declaration with a submitted version in force, being amended or not. */
export type FiledDeclaration = Omit<
  DeclarationListItem,
  'status' | 'reference' | 'currentVersion' | 'submittedAt' | 'late' | 'acknowledgement'
> & {
  status: 'submitted' | 'amending';
  reference: string;
  currentVersion: number;
  submittedAt: string;
  late: boolean;
  acknowledgement: Acknowledgement;
};

export type MyDeclarationRow =
  | { kind: 'draft'; declaration: DeclarationListItem }
  | { kind: 'filed'; declaration: FiledDeclaration };

export interface MyDeclarationsPage {
  status: 'ok';
  rows: MyDeclarationRow[];
  /** 1-based; clamped to the last page. */
  page: number;
  pageSize: PageSize;
  /** Declarations on every page. */
  total: number;
}

/** The list item as a filed row, or null when it lacks what the service gives a filed one. */
function asFiled(item: DeclarationListItem): FiledDeclaration | null {
  const { status, reference, currentVersion, submittedAt, late, acknowledgement } = item;
  if (status !== 'submitted' && status !== 'amending') return null;
  if (reference === null || currentVersion === null || submittedAt === null) return null;
  if (late === null || acknowledgement === null) return null;
  return { ...item, status, reference, currentVersion, submittedAt, late, acknowledgement };
}

/**
 * The page of the declarant's declarations (`GET /v1/me/declarations`), ordered as
 * `orderDeclarations`. A caller who is not a declarant has none.
 */
export function loadMyDeclarations(
  client: DeclarationsClient,
  { page, pageSize }: { page: number; pageSize: PageSize },
): Promise<MyDeclarationsPage | Unavailable> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/me/declarations');
    if (!data && response.status !== 404) return unavailable;
    const ordered = orderDeclarations(data ?? []);
    const slice = pageOf(ordered, page, pageSize);
    const rows: MyDeclarationRow[] = [];
    for (const item of slice.items) {
      if (item.status === 'draft') {
        rows.push({ kind: 'draft', declaration: item });
        continue;
      }
      const filed = asFiled(item);
      // A filed declaration without its version in force is an answer the page cannot show.
      if (!filed) return unavailable;
      rows.push({ kind: 'filed', declaration: filed });
    }
    return { status: 'ok', rows, page: slice.page, pageSize, total: ordered.length };
  });
}

export type VersionsResult =
  { status: 'ok'; versions: DeclarationVersion[] } | NotFound | Unavailable;

/** `GET /v1/declarations/{id}/versions`: every submitted version, newest first. */
export function loadVersions(
  client: DeclarationsClient,
  declarationId: string,
): Promise<VersionsResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/declarations/{declarationId}/versions', {
      params: { path: { declarationId } },
    });
    if (data) return { status: 'ok', versions: data };
    return response.status === 404 ? notFound : unavailable;
  });
}

/** A submitted version, with the declaration it belongs to (for certified copies). */
export interface SubmittedVersion {
  declarationId: string;
  commission: DeclarationListItem['commission'];
  type: DeclarationListItem['type'];
  statementDate: string;
  version: DeclarationVersion;
}

export type SubmittedVersionsResult = { status: 'ok'; versions: SubmittedVersion[] } | Unavailable;

/**
 * Every submitted version of every declaration of the declarant: the declarations with a
 * version in force (`GET /v1/me/declarations`, latest statement date first), each with its
 * versions newest first (`GET /v1/declarations/{id}/versions`, read side by side). A declarant
 * files a handful of declarations, so one call each is fine. Any call failing fails the whole.
 */
export function loadSubmittedVersions(
  client: DeclarationsClient,
): Promise<SubmittedVersionsResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/me/declarations');
    if (!data && response.status !== 404) return unavailable;
    const filed = (data ?? [])
      .filter((item) => item.status !== 'discarded' && item.currentVersion !== null)
      .sort((a, b) => b.statementDate.localeCompare(a.statementDate));
    const results = await Promise.all(filed.map((item) => loadVersions(client, item.id)));
    const versions: SubmittedVersion[] = [];
    for (const [index, result] of results.entries()) {
      const item = filed[index];
      if (!item || result.status !== 'ok') return unavailable;
      for (const version of result.versions) {
        versions.push({
          declarationId: item.id,
          commission: item.commission,
          type: item.type,
          statementDate: item.statementDate,
          version,
        });
      }
    }
    return { status: 'ok', versions };
  });
}

export type AmendOutcome =
  | { status: 'amending'; declaration: Declaration }
  /** 409: the due date has passed, or the declaration is not submitted (changed elsewhere). */
  | { status: 'conflict'; code: 'amendment-window-closed' | 'not-submitted' }
  | NotFound
  | Unavailable;

/**
 * `POST /v1/declarations/{id}/amend`: the version in force's sections, reopened (an amendment
 * already in progress answers as it is).
 */
export function amendDeclaration(
  client: DeclarationsClient,
  declarationId: string,
): Promise<AmendOutcome> {
  return attempt(async () => {
    const { data, error, response } = await client.POST('/v1/declarations/{declarationId}/amend', {
      params: { path: { declarationId } },
    });
    if (data) return { status: 'amending', declaration: data };
    if (response.status === 409) {
      // A cancelled obligation closes amendments as the due date does.
      const closed =
        error.code === 'amendment-window-closed' || error.code === 'obligation-cancelled';
      return {
        status: 'conflict',
        code: closed ? 'amendment-window-closed' : 'not-submitted',
      };
    }
    return response.status === 404 ? notFound : unavailable;
  });
}

export type DiscardAmendmentOutcome =
  | { status: 'discarded'; declaration: Declaration }
  /** 409: the declaration was never submitted. */
  | { status: 'not-amending' }
  | NotFound
  | Unavailable;

/**
 * `POST /v1/declarations/{id}/amend/discard`: back to the version in force, untouched (a
 * submitted declaration answers as it is).
 */
export function discardAmendment(
  client: DeclarationsClient,
  declarationId: string,
): Promise<DiscardAmendmentOutcome> {
  return attempt(async () => {
    const { data, response } = await client.POST('/v1/declarations/{declarationId}/amend/discard', {
      params: { path: { declarationId } },
    });
    if (data) return { status: 'discarded', declaration: data };
    if (response.status === 409) return { status: 'not-amending' };
    return response.status === 404 ? notFound : unavailable;
  });
}
