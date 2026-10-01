import { ProblemException } from '@adili/api-kit';
import type { DeclarationIssue } from '@adili/forms';

import type { AmendRefusal, ObligationRefusal } from '../declaration/window.js';

/** The problems the submission route answers with, each built in one place. */

/** 403 with where to step up: the step-up ACR is missing, or its code is too old. */
export function stepUpRequired(stepUpUrl: string, detail: string): ProblemException {
  return ProblemException.fromCode('step-up-required', { detail, extensions: { stepUpUrl } });
}

/** 400 with what blocks it, as the summary lists it. */
export function incomplete(blocking: DeclarationIssue[]): ProblemException {
  return ProblemException.fromCode('incomplete', {
    detail: 'The declaration does not validate yet; complete what is listed and submit again.',
    extensions: { blocking },
  });
}

/** Submitting an amendment and starting one are refused alike once the due date has passed. */
const AMENDMENT_WINDOW_CLOSED =
  'Amendments closed on the due date; changes now go through the Commission.';

const REFUSALS: Record<ObligationRefusal, string> = {
  'not-a-draft': 'Only a draft declaration or an amendment in progress can be submitted.',
  'obligation-cancelled': 'The filing obligation was cancelled; there is nothing to file.',
  'before-statement-date': 'A declaration can be submitted from its statement date.',
  'amendment-window-closed': AMENDMENT_WINDOW_CLOSED,
};

/** 409 for a declaration or obligation that does not take the submission now. */
export function refused(refusal: ObligationRefusal): ProblemException {
  return ProblemException.fromCode(refusal, { detail: REFUSALS[refusal] });
}

const AMEND_REFUSALS: Record<AmendRefusal, string> = {
  'not-submitted': 'Only a submitted declaration can be amended.',
  'obligation-cancelled': 'The filing obligation was cancelled; there is nothing to amend.',
  'amendment-window-closed': AMENDMENT_WINDOW_CLOSED,
};

/** 409 for a declaration that cannot be reopened for amendment (or have one discarded) now. */
export function amendRefused(refusal: AmendRefusal): ProblemException {
  return ProblemException.fromCode(refusal, { detail: AMEND_REFUSALS[refusal] });
}
