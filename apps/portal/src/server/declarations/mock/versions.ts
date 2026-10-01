/**
 * The mock's filed versions (spec 06): versions, amend, discard amendment and each version's
 * acknowledgement slip.
 */
import { json, problem } from '../../mock-http';
import { readAcknowledgement, reissueAcknowledgement } from './acknowledgement';
import { etag, store, type Stored, view } from './store';
import { filingWindow } from './submission';
import { submitProblem } from './submit';

/** `GET /v1/declarations/{id}/versions`, newest first. */
export function listVersions(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  const now = Date.now();
  return json(
    200,
    [...stored.versions]
      .reverse()
      .map((version) => ({ ...version, acknowledgement: readAcknowledgement(version, now) })),
  );
}

/** `GET /v1/declarations/{id}/versions/{n}`, with the document as filed. */
export function getVersion(id: string, number: number) {
  const version = submittedVersion(id, number);
  const filed = store.get(id)?.filed.get(number);
  if (!version || !filed) return problem(404, 'Not found');
  return json(200, {
    ...version,
    acknowledgement: readAcknowledgement(version),
    document: filed.document,
  });
}

/** Why Amend is refused today, in the service's order, or null when it is open. */
export function amendRefusal(stored: Stored) {
  if (stored.status !== 'submitted') return 'not-submitted';
  const window = filingWindow(stored.filing);
  if (window === 'cancelled') return 'obligation-cancelled';
  if (window === 'overdue') return 'amendment-window-closed';
  return null;
}

/** The sections back as the version in force filed them, at a new draft version. */
export function reopen(stored: Stored) {
  const filed = stored.header.currentVersion && stored.filed.get(stored.header.currentVersion);
  if (!filed) return;
  Object.assign(stored, structuredClone(filed.sections));
  stored.draftVersion += 1;
  stored.updatedAt = new Date().toISOString();
}

/** `POST /v1/declarations/{id}/amend`: until the due date; an amendment in progress as it is. */
export function amendDeclaration(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  if (stored.status !== 'amending') {
    const refusal = amendRefusal(stored);
    if (refusal) return submitProblem(409, 'The declaration cannot be amended', refusal);
    reopen(stored);
    stored.status = 'amending';
    stored.header.amendingFromVersion = stored.header.currentVersion;
  }
  return json(200, view(stored), { ETag: etag(stored) });
}

/** `POST /v1/declarations/{id}/amend/discard`: back to the version in force. */
export function discardAmendment(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  if (stored.status === 'draft') {
    return submitProblem(409, 'The declaration was never submitted', 'not-submitted');
  }
  if (stored.status === 'amending') {
    reopen(stored);
    stored.status = 'submitted';
    stored.header.amendingFromVersion = null;
  }
  return json(200, view(stored), { ETag: etag(stored) });
}

export function submittedVersion(id: string, number: number) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return undefined;
  return stored.versions.find((version) => version.version === number);
}

/** `GET /v1/declarations/{id}/versions/{n}/acknowledgement`. */
export function getAcknowledgement(id: string, number: number) {
  const version = submittedVersion(id, number);
  return version ? json(200, readAcknowledgement(version)) : problem(404, 'Not found');
}

/** `POST /v1/declarations/{id}/versions/{n}/acknowledgement/reissue`. */
export function reissue(id: string, number: number) {
  const version = submittedVersion(id, number);
  if (!version) return problem(404, 'Not found');
  const answer = reissueAcknowledgement(version);
  if (answer.status === 202) return new Response(null, { status: 202 });
  if (answer.status === 409) {
    return problem(
      409,
      answer.code === 'acknowledgement-issued'
        ? 'The acknowledgement slip is issued'
        : 'The acknowledgement slip is still being prepared',
      answer.code,
    );
  }
  return json(429, {
    type: 'about:blank',
    title: 'The acknowledgement slip was asked for again a moment ago',
    status: 429,
    code: 'resend-cooldown',
    retryAfterSeconds: answer.retryAfterSeconds,
  });
}
