/**
 * In-memory stand-in for the declarations service (declarations.yaml), in two parts with a flag
 * each: the declarant's obligations (OBLIGATIONS_MOCK, spec 04), and declaration drafts
 * (DECLARATIONS_MOCK), to work on the portal without the service and for spec 05's
 * endpoints until the service implements them (#115). Requests of a part that is off go to the
 * real service, so real obligations work with mocked drafts. Like the service, drafts belong to
 * the declarant who started them (the bearer token's `person_id`, read without checking the
 * signature): the list shows only theirs and anyone else's answers 404. The bio is pre-filled
 * from the caller's own roster entry (`ROSTERS`).
 *
 * The declarant's obligations and their detail come from `./mock/obligations.ts`, by the token's
 * person. A declaration can be started for any of those (or, with the obligations mock off, for
 * any obligation the real service shows the caller), or for one of these (`MOCK_OBLIGATIONS`,
 * for tests, not listed):
 * - Teachers Service Commission, biennial 2027: upcoming, statement date 1 Nov 2027, income
 *   period assumed (S1). A draft can be prepared; submission waits for the statement date.
 * - Public Service Commission, initial: due, statement date 10 Sep 2026.
 * - National Police Service Commission, final: filed, so starting answers 409.
 * - Parliamentary Service Commission, biennial 2025: cancelled, so starting answers 409.
 *
 * Starting a declaration creates the bio (pre-filled from the Commission's roster), household,
 * the declarant's own statement and other information; a second start returns the same draft
 * (200).
 * The TSC roster has HR values (marital status, job group, date of appointment, work station)
 * that pre-fill the bio; the PSC roster has none, so those stay empty (spec 05b S8). The PSC
 * draft's own statement starts with two assets accepted from registries (NTSA, ArdhiSasa),
 * so source badges show (S11).
 * Every save needs `If-Match` with the current draft version (412 when stale, 428 when missing)
 * and bumps the version; the roster fields answer 400 `identity-locked-field` and a nil flag
 * with items answers 400 `nil-conflicts-with-items` (S4, S8). Household saves create, archive
 * and restore statements (S5). Completeness rules per section live in `./mock/*.ts`.
 *
 * Registry lookups, document extraction, suggestions, accept and dismiss (spec 05b) live in
 * `./mock/suggestions.ts`.
 *
 * Submission (spec 06) follows the service's preconditions in order: the declaration is a draft
 * (409 `not-a-draft`), `Idempotency-Key` is present (400) and a replay answers the stored 201,
 * the token has a step-up at most five minutes old (403 `step-up-required` with `stepUpUrl`,
 * see `./mock/submission.ts`), nothing blocks (400 `incomplete` with the blocking issues), and
 * the obligation is open: before its statement date 409 `before-statement-date`, cancelled 409
 * `obligation-cancelled`, an amendment after the due date 409 `amendment-window-closed`. Then
 * the declaration is `submitted` with a new version: the reference is allocated on version 1
 * (`DCB-TSC-2027-0000001-B`), `late` when after the due date, the acknowledgement `pending`,
 * and the obligations mock reads its obligation `filed` from then on.
 * Summaries answer `cannotSubmitReason` as the service does (the refusal first, then
 * `incomplete`), `canSubmit` when there is none, and `late` after the due date. The slip is
 * issued a few seconds later, or reads failed a minute on, when it can be asked for again
 * (`./mock/acknowledgement.ts`).
 *
 * Amendments follow the service too: amend reopens a submitted declaration until its due date
 * (after it 409 `amendment-window-closed`, a draft 409 `not-submitted`, an amendment in progress
 * answered as it is) with the sections as the version in force filed them; discarding the
 * amendment puts them back and the declaration is `submitted` again. Each version keeps its
 * document (`GET /v1/declarations/{id}/versions/{n}`). "My declarations" rows carry the
 * reference, the version in force (submitted at, late, slip), and `amendable`.
 *
 * Tests can make the next saves fail (`failNextSaves`) or submits fail (`failNextSubmits`), make
 * slips never come (`setSlipIssuance`),
 * simulate an edit on another device (`editElsewhere`), make registries answer at once
 * (`setLookupDelay(0)`) or play a Commission without AI (`setExtractionEnabled(false)`).
 *
 * This file routes; each part lives in `./mock/`: `fixtures.ts`, the store and its views
 * (`store.ts`), drafts (`drafts.ts`), submission (`submit.ts`) and filed versions, amendments and
 * slips (`versions.ts`).
 */
import { problem } from '../mock-http';
import { resetAcknowledgementMock } from './mock/acknowledgement';
import { ask, openConversation, rate, resetAssistantMock, searchHelp } from './mock/assistant';
import {
  commit,
  discard,
  getDeclaration,
  getSection,
  linkAttachment,
  mockObligation,
  myDeclarations,
  realObligation,
  type RealService,
  resetDraftsMock,
  saveSection,
  startDeclaration,
  unlinkAttachment,
} from './mock/drafts';
import {
  bearerClaims,
  isObligationRead,
  obligationReads,
  resetObligationsMock,
} from './mock/obligations';
import { draft, store } from './mock/store';
import { resetSubmissionMock } from './mock/submission';
import { getSummary, resetSubmitMock, submitDeclaration } from './mock/submit';
import {
  acceptSuggestion,
  dismissSuggestion,
  listSuggestions,
  requestExtraction,
  requestLookups,
  resetSuggestionsMock,
} from './mock/suggestions';
import {
  amendDeclaration,
  discardAmendment,
  getAcknowledgement,
  getVersion,
  listVersions,
  reissue,
} from './mock/versions';

export { MOCK_OBLIGATIONS } from './mock/fixtures';
export { failNextSaves, editElsewhere } from './mock/drafts';
export { failNextSubmits } from './mock/submit';
export { setSlipIssuance } from './mock/acknowledgement';
export { setExtractionEnabled, setLookupDelay } from './mock/suggestions';
export { setAnswerPace, setAssistantMode, type AssistantMode } from './mock/assistant';

/** Clears every draft (tests). */
export function resetDeclarationsMock() {
  store.clear();
  resetDraftsMock();
  resetSubmitMock();
  resetSuggestionsMock();
  resetSubmissionMock();
  resetAcknowledgementMock();
  resetObligationsMock();
  resetAssistantMock();
}

/** The parts of the service the mock answers; the others go to the real service. */
export interface DeclarationsMockParts {
  /** The declarant's obligations and one obligation's detail (OBLIGATIONS_MOCK). */
  obligations: boolean;
  /**
   * Everything else: drafts, submission, versions, amendments and acknowledgements
   * (DECLARATIONS_MOCK).
   */
  declarations: boolean;
  /** Ask Adili's conversations and answers, and help search (ASSISTANT_MOCK). */
  assistant: boolean;
}

/** A client fetch answering `parts` in memory and passing the rest to the real service. */
export function declarationsMock(
  parts: DeclarationsMockParts,
  realFetch: typeof fetch = fetch,
): (request: Request, init?: RequestInit) => Promise<Response> {
  return (request, init) => route(request, parts, (real) => realFetch(real, init));
}

/** The whole service in memory (tests). */
export function mockDeclarationsFetch(request: Request): Promise<Response> {
  return route(request, { obligations: true, declarations: true, assistant: true }, () =>
    Promise.reject(new Error('every part is mocked')),
  );
}

async function route(
  request: Request,
  parts: DeclarationsMockParts,
  real: RealService,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const path = decodeURIComponent(pathname);
  const method = request.method;

  if (isObligationRead(request, path)) {
    return parts.obligations ? (obligationReads(request, path) ?? real(request)) : real(request);
  }
  const claims = bearerClaims(request);
  const caller = claims?.person_id ?? null;
  if (path.startsWith('/v1/me/assistant/') || path === '/v1/help/search') {
    return parts.assistant ? assistant(request, url, path, caller) : real(request);
  }
  if (!parts.declarations) return real(request);
  if (method === 'GET' && path === '/v1/me/declarations') return myDeclarations(caller);

  const start = /^\/v1\/obligations\/([^/]+)\/declaration$/.exec(path);
  if (method === 'POST' && start?.[1]) {
    const obligationId = start[1];
    const obligation = parts.obligations
      ? mockObligation(obligationId)
      : await realObligation(request, obligationId, real);
    return startDeclaration(claims, obligationId, obligation);
  }

  // Someone else's declaration is not visible to the caller, whatever they ask of it.
  const declarationId = /^\/v1\/declarations\/([^/]+)/.exec(path)?.[1];
  const owned = declarationId === undefined ? undefined : store.get(declarationId);
  if (owned && owned.owner !== caller) return problem(404, 'Not found');

  const section = /^\/v1\/declarations\/([^/]+)\/sections\/([^/]+)$/.exec(path);
  if (section?.[1] && section[2]) {
    if (method === 'GET') return getSection(section[1], section[2]);
    if (method === 'PUT') return saveSection(request, section[1], section[2]);
  }

  const attachments = /^\/v1\/declarations\/([^/]+)\/attachments$/.exec(path);
  if (method === 'POST' && attachments?.[1]) return linkAttachment(request, attachments[1]);

  const attachment = /^\/v1\/declarations\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
  if (method === 'DELETE' && attachment?.[1] && attachment[2]) {
    return unlinkAttachment(attachment[1], attachment[2]);
  }

  const extract = /^\/v1\/declarations\/([^/]+)\/attachments\/([^/]+)\/extract$/.exec(path);
  if (method === 'POST' && extract?.[1] && extract[2]) {
    const stored = draft(extract[1]);
    if (!stored) return problem(404, 'Not found');
    return requestExtraction(request, stored, stored.attachments.get(extract[2]));
  }

  const lookups = /^\/v1\/declarations\/([^/]+)\/suggestions\/lookups$/.exec(path);
  if (method === 'POST' && lookups?.[1]) {
    const stored = draft(lookups[1]);
    return stored ? requestLookups(request, stored) : problem(404, 'Not found');
  }

  const suggestions = /^\/v1\/declarations\/([^/]+)\/suggestions$/.exec(path);
  if (method === 'GET' && suggestions?.[1]) {
    const stored = draft(suggestions[1]);
    return stored ? listSuggestions(url, stored) : problem(404, 'Not found');
  }

  const decide = /^\/v1\/declarations\/([^/]+)\/suggestions\/([^/]+)\/(accept|dismiss)$/.exec(path);
  if (method === 'POST' && decide?.[1] && decide[2]) {
    const stored = draft(decide[1]);
    if (!stored) return problem(404, 'Not found');
    return decide[3] === 'accept'
      ? acceptSuggestion(request, stored, decide[2], (key) => commit(stored, key))
      : dismissSuggestion(request, stored, decide[2]);
  }

  const submit = /^\/v1\/declarations\/([^/]+)\/submit$/.exec(path);
  if (method === 'POST' && submit?.[1]) return submitDeclaration(request, submit[1]);

  const amend = /^\/v1\/declarations\/([^/]+)\/amend(\/discard)?$/.exec(path);
  if (method === 'POST' && amend?.[1]) {
    return amend[2] ? discardAmendment(amend[1]) : amendDeclaration(amend[1]);
  }

  const versions = /^\/v1\/declarations\/([^/]+)\/versions$/.exec(path);
  if (method === 'GET' && versions?.[1]) return listVersions(versions[1]);

  const oneVersion = /^\/v1\/declarations\/([^/]+)\/versions\/(\d+)$/.exec(path);
  if (method === 'GET' && oneVersion?.[1] && oneVersion[2]) {
    return getVersion(oneVersion[1], Number(oneVersion[2]));
  }

  const slip = /^\/v1\/declarations\/([^/]+)\/versions\/(\d+)\/acknowledgement(\/reissue)?$/.exec(
    path,
  );
  if (slip?.[1] && slip[2]) {
    if (method === 'GET' && !slip[3]) return getAcknowledgement(slip[1], Number(slip[2]));
    if (method === 'POST' && slip[3]) return reissue(slip[1], Number(slip[2]));
  }

  const summary = /^\/v1\/declarations\/([^/]+)\/summary$/.exec(path);
  if (method === 'GET' && summary?.[1]) return getSummary(summary[1]);

  const one = /^\/v1\/declarations\/([^/]+)$/.exec(path);
  if (one?.[1]) {
    if (method === 'GET') return getDeclaration(one[1]);
    if (method === 'DELETE') return discard(one[1]);
  }

  return problem(404, 'Not found');
}

function assistant(
  request: Request,
  url: URL,
  path: string,
  caller: string | null,
): Promise<Response> | Response {
  const { method } = request;
  if (method === 'GET' && path === '/v1/help/search') return searchHelp(url, caller);
  if (method === 'POST' && path === '/v1/me/assistant/conversations') {
    return openConversation(request, caller);
  }
  const messages = /^\/v1\/me\/assistant\/conversations\/([^/]+)\/messages$/.exec(path);
  if (method === 'POST' && messages?.[1]) return ask(request, caller, messages[1]);
  const feedback =
    /^\/v1\/me\/assistant\/conversations\/([^/]+)\/messages\/([^/]+)\/feedback$/.exec(path);
  if (method === 'PUT' && feedback?.[1] && feedback[2]) {
    return rate(request, caller, feedback[1], feedback[2]);
  }
  return problem(404, 'Not found');
}
