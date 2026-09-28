import type { SectionContentsByKind } from '../declaration/contents';
import type { DeclarationsClient } from './declarations/client.server';
import type {
  Declaration,
  DeclarationAttachment,
  DeclarationListItem,
  DeclarationSummary,
  DocumentKind,
  MyObligations,
  RegistrySystem,
  SectionEnvelope,
  SectionKey,
  SectionSaveResult,
  Suggestion,
  SuggestionSet,
} from './declarations/types';

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

export interface Unavailable {
  status: 'unavailable';
}
export interface NotFound {
  status: 'not-found';
}

const unavailable: Unavailable = { status: 'unavailable' };
const notFound: NotFound = { status: 'not-found' };

/** The service's ETag, or the draft version quoted the same way when a proxy dropped it. */
function etagOf(response: Response, draftVersion: number) {
  return response.headers.get('ETag') ?? `"${String(draftVersion)}"`;
}

async function attempt<T>(call: () => Promise<T>): Promise<T | Unavailable> {
  try {
    return await call();
  } catch {
    return unavailable;
  }
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

/** A suggestion as it crosses to the browser: its free-form objects typed as JSON. */
export type LoadedSuggestion = Omit<Suggestion, 'fields' | 'sourceRef'> & {
  fields: JsonObject;
  sourceRef: JsonObject;
};

export type LoadedSuggestionSet = Omit<SuggestionSet, 'suggestions'> & {
  suggestions: LoadedSuggestion[];
};

function loadedSuggestion(suggestion: Suggestion): LoadedSuggestion {
  return {
    ...suggestion,
    fields: suggestion.fields as JsonObject,
    sourceRef: suggestion.sourceRef as JsonObject,
  };
}

function loadedSet(set: SuggestionSet): LoadedSuggestionSet {
  return { ...set, suggestions: set.suggestions.map(loadedSuggestion) };
}

function problemCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

export interface RegistryLookupsInput {
  declarationId: string;
  personKey: string;
  systems: RegistrySystem[];
  /** The consent text the declarant ticked, by version. */
  textVersion: string;
  /** One per logical request; reuse it when retrying the same request. */
  idempotencyKey: string;
}

export type RegistryLookupsResult =
  | { status: 'started'; sets: LoadedSuggestionSet[] }
  /** 400 `no-id`: the person has no national ID on record. */
  | { status: 'no-id' }
  /** Any other 400, e.g. the consent is missing. */
  | { status: 'rejected'; code: string | null }
  | NotFound
  | Unavailable;

/**
 * `POST /v1/declarations/{id}/suggestions/lookups`: asks the registries about one person with
 * their consent recorded. Answers one set per registry, usually still `pending`: poll
 * `listSuggestions` until none is.
 */
export function requestLookups(
  client: DeclarationsClient,
  input: RegistryLookupsInput,
): Promise<RegistryLookupsResult> {
  return attempt(async () => {
    const { data, error, response } = await client.POST(
      '/v1/declarations/{declarationId}/suggestions/lookups',
      {
        params: {
          path: { declarationId: input.declarationId },
          header: { 'Idempotency-Key': input.idempotencyKey },
        },
        body: {
          personKey: input.personKey,
          systems: input.systems,
          consent: { requested: true, textVersion: input.textVersion },
        },
      },
    );
    if (data) return { status: 'started', sets: data.map(loadedSet) };
    if (response.status === 400) {
      const code = problemCode(error);
      return code === 'no-id' ? { status: 'no-id' } : { status: 'rejected', code };
    }
    return response.status === 404 ? notFound : unavailable;
  });
}

export interface ListSuggestionsInput {
  declarationId: string;
  personKey?: string;
  sectionKey?: SectionKey;
}

export type SuggestionsResult =
  { status: 'ok'; sets: LoadedSuggestionSet[] } | NotFound | Unavailable;

/**
 * `GET /v1/declarations/{id}/suggestions`: the draft's suggestion sets with their suggestions,
 * narrowed to a person or a section. Also the way to poll a pending lookup or extraction, as
 * the contract has no per-set read.
 */
export function listSuggestions(
  client: DeclarationsClient,
  input: ListSuggestionsInput,
): Promise<SuggestionsResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/declarations/{declarationId}/suggestions', {
      params: {
        path: { declarationId: input.declarationId },
        query: {
          ...(input.personKey ? { personKey: input.personKey } : {}),
          ...(input.sectionKey ? { sectionKey: input.sectionKey } : {}),
        },
      },
    });
    if (data) return { status: 'ok', sets: data.map(loadedSet) };
    return response.status === 404 ? notFound : unavailable;
  });
}

export interface AcceptSuggestionInput {
  declarationId: string;
  suggestionId: string;
  /** The draft-wide ETag last seen. */
  ifMatch: string;
  /** The fields to add, after the declarant's edits. */
  fields: JsonObject;
  /** The matching item to apply the fields to, or null to add a new item. */
  applyToItemId: string | null;
  /** When applying: replace fields the item already has (only empty ones by default). */
  overwrite?: boolean;
}

export type AcceptOutcome =
  | { status: 'accepted'; suggestion: LoadedSuggestion; itemId: string; etag: string }
  /**
   * 412, or 409: the draft changed since `ifMatch`, or the suggestion is no longer `new` (the
   * contract uses 409 for both). Re-read the section and try once more.
   */
  | { status: 'conflict'; code: string | null }
  /** 400: the fields were refused. */
  | { status: 'rejected'; code: string | null }
  | NotFound
  | Unavailable;

/**
 * `POST .../suggestions/{id}/accept` with `If-Match`: the service adds the item (or fills the
 * matching one) through the section save path, marks it with its source, and answers the new
 * ETag. Run it under the workspace's `whileHeld` so autosave waits.
 */
export function acceptSuggestion(
  client: DeclarationsClient,
  input: AcceptSuggestionInput,
): Promise<AcceptOutcome> {
  return attempt(async () => {
    const { data, error, response } = await client.POST(
      '/v1/declarations/{declarationId}/suggestions/{suggestionId}/accept',
      {
        params: {
          path: { declarationId: input.declarationId, suggestionId: input.suggestionId },
          header: { 'If-Match': input.ifMatch },
        },
        body: {
          fields: input.fields,
          applyToItemId: input.applyToItemId,
          ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
        },
      },
    );
    if (data) {
      return {
        status: 'accepted',
        suggestion: loadedSuggestion(data.suggestion),
        itemId: data.itemId,
        etag: data.etag,
      };
    }
    if (response.status === 409 || response.status === 412) {
      return { status: 'conflict', code: problemCode(error) };
    }
    if (response.status === 400) return { status: 'rejected', code: problemCode(error) };
    return response.status === 404 ? notFound : unavailable;
  });
}

export type DismissOutcome =
  | { status: 'dismissed'; suggestion: LoadedSuggestion }
  /** 409: it was accepted already. */
  | { status: 'already-accepted' }
  | NotFound
  | Unavailable;

export interface DismissSuggestionInput {
  declarationId: string;
  suggestionId: string;
  /** Why the declarant set it aside, if they said. */
  reason?: string;
}

/** `POST .../suggestions/{id}/dismiss`: sets the suggestion aside, with an optional reason. */
export function dismissSuggestion(
  client: DeclarationsClient,
  input: DismissSuggestionInput,
): Promise<DismissOutcome> {
  return attempt(async () => {
    const { data, response } = await client.POST(
      '/v1/declarations/{declarationId}/suggestions/{suggestionId}/dismiss',
      {
        params: {
          path: { declarationId: input.declarationId, suggestionId: input.suggestionId },
        },
        body: input.reason === undefined ? {} : { reason: input.reason },
      },
    );
    if (data) return { status: 'dismissed', suggestion: loadedSuggestion(data) };
    if (response.status === 409) return { status: 'already-accepted' };
    return response.status === 404 ? notFound : unavailable;
  });
}

export interface ExtractAttachmentInput {
  declarationId: string;
  attachmentId: string;
  documentKindHint: DocumentKind;
  /** The declaration.v1 item type the fields are for, e.g. `vehicle`. */
  targetItemType: string;
  language?: 'en' | 'sw';
  /** One per logical request; reuse it when retrying the same request. */
  idempotencyKey: string;
}

export type ExtractResult =
  | { status: 'started'; set: LoadedSuggestionSet }
  /** 409 `not-enabled`: the Commission has no AI policy for documents. */
  | { status: 'not-enabled' }
  /** Any other 409 (e.g. the attachment is not clean) or 400. */
  | { status: 'refused'; code: string | null }
  | NotFound
  | Unavailable;

/**
 * `POST /v1/declarations/{id}/attachments/{attachmentId}/extract`: asks for a linked document to
 * be read into fields. Answers a `document` set, usually `pending`: poll `listSuggestions` until
 * it is `ready` (one suggestion), `failed` or `not-enabled`.
 */
export function extractAttachment(
  client: DeclarationsClient,
  input: ExtractAttachmentInput,
): Promise<ExtractResult> {
  return attempt(async () => {
    const { data, error, response } = await client.POST(
      '/v1/declarations/{declarationId}/attachments/{attachmentId}/extract',
      {
        params: {
          path: { declarationId: input.declarationId, attachmentId: input.attachmentId },
          header: { 'Idempotency-Key': input.idempotencyKey },
        },
        body: {
          documentKindHint: input.documentKindHint,
          targetItemType: input.targetItemType,
          ...(input.language ? { language: input.language } : {}),
        },
      },
    );
    if (data) return { status: 'started', set: loadedSet(data) };
    if (response.status === 409 || response.status === 400) {
      const code = problemCode(error);
      return code === 'not-enabled' ? { status: 'not-enabled' } : { status: 'refused', code };
    }
    return response.status === 404 ? notFound : unavailable;
  });
}
