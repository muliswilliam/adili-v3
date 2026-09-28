import type { SectionContentsByKind } from '../declaration/contents';
import type { DeclarationsClient } from './declarations/client.server';
import type {
  Declaration,
  DeclarationAttachment,
  DeclarationListItem,
  DeclarationSummary,
  MyObligations,
  SectionEnvelope,
  SectionKey,
  SectionSaveResult,
} from './declarations/types';
import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * The declarations service's spec 05 endpoints, reduced to discriminated results the routes
 * and the autosave queue can branch on. Pure: the caller injects the client (see
 * `declarations.ts` for the server functions that call these as the signed-in declarant).
 */

/** JSON as it crosses the server function boundary; section contents are open objects. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = Record<string, Json>;

/** A section as loaded, with its contents typed as JSON so they cross to the browser. */
export type LoadedSection = Omit<SectionEnvelope, 'contents'> & { contents: JsonObject };

export type LoadedSummary = Omit<DeclarationSummary, 'document'> & { document: JsonObject };

/** The service's ETag, or the draft version quoted the same way when a proxy dropped it. */
function etagOf(response: Response, draftVersion: number) {
  return response.headers.get('ETag') ?? `"${String(draftVersion)}"`;
}

export type ObligationsResult = { status: 'ok'; obligations: MyObligations } | Unavailable;

/** `GET /v1/me/obligations` (spec 04); a caller who is not a declarant has none. */
export function listObligations(client: DeclarationsClient): Promise<ObligationsResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/me/obligations');
    if (data) return { status: 'ok', obligations: data };
    return response.status === 404 ? { status: 'ok', obligations: { groups: [] } } : unavailable;
  });
}

export type StartResult =
  | { status: 'started'; declaration: Declaration; created: boolean }
  /** 409: the obligation is filed or cancelled. */
  | { status: 'not-open' }
  | NotFound
  | Unavailable;

/** `POST /v1/obligations/{id}/declaration`: a new draft (201) or the existing one (200). */
export function startDeclaration(
  client: DeclarationsClient,
  obligationId: string,
): Promise<StartResult> {
  return attempt(async () => {
    const { data, response } = await client.POST('/v1/obligations/{id}/declaration', {
      params: { path: { id: obligationId } },
    });
    if (data) return { status: 'started', declaration: data, created: response.status === 201 };
    if (response.status === 409) return { status: 'not-open' };
    return response.status === 404 ? notFound : unavailable;
  });
}

export type DeclarationListResult =
  { status: 'ok'; declarations: DeclarationListItem[] } | Unavailable;

/** `GET /v1/me/declarations`; a caller who is not a declarant has none. */
export function listDeclarations(client: DeclarationsClient): Promise<DeclarationListResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/me/declarations');
    if (data) return { status: 'ok', declarations: data };
    return response.status === 404 ? { status: 'ok', declarations: [] } : unavailable;
  });
}

export type DeclarationResult =
  { status: 'ok'; declaration: Declaration; etag: string } | NotFound | Unavailable;

/** `GET /v1/declarations/{id}`: header and completeness, with the draft's ETag. */
export function loadDeclaration(
  client: DeclarationsClient,
  declarationId: string,
): Promise<DeclarationResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/declarations/{declarationId}', {
      params: { path: { declarationId } },
    });
    if (data) {
      return { status: 'ok', declaration: data, etag: etagOf(response, data.draftVersion) };
    }
    return response.status === 404 ? notFound : unavailable;
  });
}

export type SectionResult =
  { status: 'ok'; section: LoadedSection; etag: string } | NotFound | Unavailable;

/** `GET /v1/declarations/{id}/sections/{key}`, always fresh from the service. */
export function loadSection(
  client: DeclarationsClient,
  declarationId: string,
  sectionKey: SectionKey,
): Promise<SectionResult> {
  return attempt(async () => {
    const { data, response } = await client.GET(
      '/v1/declarations/{declarationId}/sections/{sectionKey}',
      { params: { path: { declarationId, sectionKey } } },
    );
    if (data) {
      const section = { ...data, contents: data.contents as JsonObject };
      return { status: 'ok', section, etag: etagOf(response, data.draftVersion) };
    }
    return response.status === 404 ? notFound : unavailable;
  });
}

export interface SaveSectionInput {
  declarationId: string;
  sectionKey: SectionKey;
  /** The draft-wide ETag last seen; the service answers 412 when another save came first. */
  ifMatch: string;
  contents: SectionContentsByKind[keyof SectionContentsByKind];
}

export type SaveOutcome =
  | { status: 'saved'; etag: string; result: SectionSaveResult }
  /** 412: saved elsewhere since this draft was loaded; reload before editing again. */
  | { status: 'conflict' }
  /** 400: the service refused the contents, e.g. `identity-locked-field`. Retrying won't help. */
  | { status: 'rejected'; code: string | null }
  | NotFound
  /** Network, 5xx or 428: worth retrying. */
  | Unavailable;

/** `PUT /v1/declarations/{id}/sections/{key}` with `If-Match`: one autosave of a whole section. */
export function saveSection(
  client: DeclarationsClient,
  input: SaveSectionInput,
): Promise<SaveOutcome> {
  return attempt(async () => {
    const { data, error, response } = await client.PUT(
      '/v1/declarations/{declarationId}/sections/{sectionKey}',
      {
        params: {
          path: { declarationId: input.declarationId, sectionKey: input.sectionKey },
          header: { 'If-Match': input.ifMatch },
        },
        body: input.contents,
      },
    );
    if (data) return { status: 'saved', etag: etagOf(response, data.draftVersion), result: data };
    if (response.status === 412) return { status: 'conflict' };
    if (response.status === 400) {
      const code = (error as { code?: unknown } | undefined)?.code;
      return { status: 'rejected', code: typeof code === 'string' ? code : null };
    }
    return response.status === 404 ? notFound : unavailable;
  });
}

export type DiscardResult =
  { status: 'discarded' } | { status: 'not-draft' } | NotFound | Unavailable;

/** `DELETE /v1/declarations/{id}`: discards a draft. */
export function discardDeclaration(
  client: DeclarationsClient,
  declarationId: string,
): Promise<DiscardResult> {
  return attempt(async () => {
    const { response } = await client.DELETE('/v1/declarations/{declarationId}', {
      params: { path: { declarationId } },
    });
    if (response.status === 204) return { status: 'discarded' };
    if (response.status === 409) return { status: 'not-draft' };
    return response.status === 404 ? notFound : unavailable;
  });
}

export interface LinkAttachmentInput {
  declarationId: string;
  sectionKey: SectionKey;
  itemId: string;
  uploadId: string;
}

export type LinkResult =
  | { status: 'linked'; attachment: DeclarationAttachment }
  /** 409: the upload is not clean, has the wrong purpose or belongs to someone else. */
  | { status: 'refused' }
  | NotFound
  | Unavailable;

/**
 * `POST /v1/declarations/{id}/attachments`. The service writes the reference into the item and
 * bumps the draft version without returning it, so reload the section's ETag afterwards.
 */
export function linkAttachment(
  client: DeclarationsClient,
  input: LinkAttachmentInput,
): Promise<LinkResult> {
  return attempt(async () => {
    const { data, response } = await client.POST('/v1/declarations/{declarationId}/attachments', {
      params: { path: { declarationId: input.declarationId } },
      body: { sectionKey: input.sectionKey, itemId: input.itemId, uploadId: input.uploadId },
    });
    if (data) return { status: 'linked', attachment: data };
    if (response.status === 409) return { status: 'refused' };
    return response.status === 404 ? notFound : unavailable;
  });
}

export type UnlinkResult = { status: 'unlinked' } | NotFound | Unavailable;

/** `DELETE /v1/declarations/{id}/attachments/{attachmentId}`. Bumps the draft version too. */
export function unlinkAttachment(
  client: DeclarationsClient,
  input: { declarationId: string; attachmentId: string },
): Promise<UnlinkResult> {
  return attempt(async () => {
    const { response } = await client.DELETE(
      '/v1/declarations/{declarationId}/attachments/{attachmentId}',
      { params: { path: input } },
    );
    if (response.status === 204) return { status: 'unlinked' };
    return response.status === 404 ? notFound : unavailable;
  });
}

export type SummaryResult = { status: 'ok'; summary: LoadedSummary } | NotFound | Unavailable;

/** `GET /v1/declarations/{id}/summary`: the assembled declaration and what blocks submission. */
export function loadSummary(
  client: DeclarationsClient,
  declarationId: string,
): Promise<SummaryResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/declarations/{declarationId}/summary', {
      params: { path: { declarationId } },
    });
    if (data) return { status: 'ok', summary: { ...data, document: data.document as JsonObject } };
    return response.status === 404 ? notFound : unavailable;
  });
}
