/**
 * The mock's submission (spec 06): the summary with its submit checks, and submit with its
 * version, reference and slip request.
 */
import { createHash } from 'node:crypto';

import { ATTESTATION_TEXT } from '../../../declaration/contents';
import { json, problem } from '../../mock-http';
import type { DeclarationSummary, DeclarationVersion, SubmissionResult } from '../types';
import { slipRequested } from './acknowledgement';
import { fileMockObligation } from './obligations';
import { documentOf, issuesFor, sectionKeys, store, view } from './store';
import { allocateReference, filingWindow, hasStepUp, pendingAcknowledgement } from './submission';

/** Submissions by Idempotency-Key: the declaration they filed and the 201 to replay. */
const submissions = new Map<string, { declarationId: string; result: SubmissionResult }>();

let failingSubmits = 0;

/** Clears the replayable submissions and the failing submits (tests). */
export function resetSubmitMock() {
  submissions.clear();
  failingSubmits = 0;
}

/** The next `count` submits answer 503 before doing anything (tests). */
export function failNextSubmits(count: number) {
  failingSubmits = count;
}

export function getSummary(id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  const live = sectionKeys(stored).filter((key) => !stored.archived.has(key));
  const blocking = live.flatMap((key) => issuesFor(stored, key));
  const window = filingWindow(stored.filing);
  // In the service's order: why the obligation refuses it, then whether anything blocks.
  const cannotSubmitReason =
    stored.status !== 'draft' && stored.status !== 'amending'
      ? 'not-a-draft'
      : window === 'cancelled'
        ? 'obligation-cancelled'
        : window === 'upcoming'
          ? 'before-statement-date'
          : stored.status === 'amending' && window === 'overdue'
            ? 'amendment-window-closed'
            : blocking.length > 0
              ? 'incomplete'
              : null;
  const summary: DeclarationSummary = {
    declaration: view(stored),
    document: documentOf(stored),
    valid: blocking.length === 0,
    blocking,
    canSubmit: cannotSubmitReason === null,
    cannotSubmitReason,
    late: window === 'overdue',
    attestationText: ATTESTATION_TEXT,
  };
  return json(200, summary);
}

export function submitProblem(status: number, title: string, code: string, extra: object = {}) {
  return json(status, { type: 'about:blank', title, status, code, ...extra });
}

/** `POST /v1/declarations/{id}/submit`, preconditions in the service's order. */
export function submitDeclaration(request: Request, id: string) {
  const stored = store.get(id);
  if (!stored || stored.status === 'discarded') return problem(404, 'Not found');
  if (failingSubmits > 0) {
    failingSubmits -= 1;
    return problem(503, 'Service unavailable');
  }
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key is required');
  const replay = submissions.get(key);
  if (replay) {
    return replay.declarationId === id
      ? json(201, replay.result)
      : problem(422, 'Idempotency-Key reused with a different request');
  }
  if (stored.status !== 'draft' && stored.status !== 'amending') {
    return submitProblem(409, 'The declaration is not a draft', 'not-a-draft');
  }
  if (!hasStepUp(request)) {
    const stepUpUrl = new URL(
      `/auth/step-up?returnTo=${encodeURIComponent(`/declarations/${id}/summary`)}`,
      'http://portal.invalid',
    ).toString();
    return submitProblem(403, 'Confirm your identity to submit', 'step-up-required', {
      stepUpUrl,
    });
  }
  const live = sectionKeys(stored).filter((section) => !stored.archived.has(section));
  const blocking = live.flatMap((section) => issuesFor(stored, section));
  if (blocking.length > 0) {
    return submitProblem(400, 'The declaration is incomplete', 'incomplete', { blocking });
  }
  const window = filingWindow(stored.filing);
  if (window === 'upcoming') {
    return submitProblem(409, 'The statement date has not come', 'before-statement-date');
  }
  if (window === 'cancelled') {
    return submitProblem(409, 'The obligation is cancelled', 'obligation-cancelled');
  }
  if (stored.status === 'amending' && window === 'overdue') {
    return submitProblem(409, 'Amendments closed on the due date', 'amendment-window-closed');
  }

  const now = new Date().toISOString();
  const previous = stored.versions.at(-1);
  if (previous) previous.supersededAt = now;
  const version: DeclarationVersion = {
    version: stored.versions.length + 1,
    reference:
      previous?.reference ??
      allocateReference(stored.header.type, stored.header.commission, stored.header.statementDate),
    submittedAt: now,
    late: window === 'overdue',
    canonicalSha256: createHash('sha256')
      .update(JSON.stringify([...stored.contents]))
      .digest('hex'),
    supersededAt: null,
    acknowledgement: pendingAcknowledgement(),
  };
  stored.versions.push(version);
  const document = documentOf(stored);
  stored.filed.set(version.version, {
    document: {
      ...document,
      attestation: {
        ...(document.attestation as object),
        declaredAt: now,
        reference: version.reference,
      },
    },
    sections: structuredClone({
      contents: stored.contents,
      savedAt: stored.savedAt,
      persons: stored.persons,
      archived: stored.archived,
      attachments: stored.attachments,
    }),
  });
  slipRequested(version);
  stored.status = 'submitted';
  stored.header.reference = version.reference;
  stored.header.currentVersion = version.version;
  stored.header.amendingFromVersion = null;
  stored.updatedAt = now;
  fileMockObligation(stored.header.obligationId);
  const result: SubmissionResult = {
    declaration: view(stored),
    version,
    obligationStatus: 'filed',
  };
  submissions.set(key, { declarationId: id, result });
  return json(201, result);
}
