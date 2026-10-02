import { type Ground, isSameScope, isScopeWithin, type Scope } from '@adili/ui';

import { DECISION_REASONS_MAX } from '../../../server/access/schemas';
import type { components } from '../../../server/access/api.gen';
import type { AccessProblem } from '../../../server/access/types';
import type { ServiceError } from '../../../server/service-call';
import { messages as m } from './messages';

/**
 * The decision form's rules (spec 10 S6, #260), pure so the Form K and the law enforcement
 * decide pages (#265) share them: what the officer may submit, mirroring the access service's
 * `decisionOf`, the body it sends, and what the service's refusal says.
 */

export type Outcome = components['schemas']['Outcome'];
export type DecisionInput = components['schemas']['DecisionInput'];
export type Decision = components['schemas']['Decision'];
/** A law enforcement request's decision: `decidedBy` null for the agency's officer. */
export type LeaDecision = components['schemas']['LeaDecision'];
export type Package = components['schemas']['Package'];

export const REASONS_MAX = DECISION_REASONS_MAX;

/** What the officer has filled in so far. */
export interface DecisionDraft {
  outcome: Outcome | null;
  /** The scope granted by a partial grant; ignored for the other outcomes. */
  scope: Scope;
  grounds: Ground[];
  reasons: string;
}

export function emptyScope(): Scope {
  return {
    years: [],
    includeSpouses: false,
    includeChildren: false,
    sections: [],
    includeClarifications: false,
  };
}

export function emptyDraft(): DecisionDraft {
  return { outcome: null, scope: emptyScope(), grounds: [], reasons: '' };
}

/** The fields at fault, by the form's names. */
export interface DecisionErrors {
  outcome?: string;
  years?: string;
  sections?: string;
  /** The granted scope as a whole (the service's `grantedScope`). */
  scope?: string;
  grounds?: string;
  reasons?: string;
}

/** Whether an outcome cites Regulation 24 grounds: a partial grant and a denial do. */
export function needsGrounds(outcome: Outcome | null): boolean {
  return outcome === 'partial-grant' || outcome === 'deny';
}

/**
 * Whether anything of the request can be left out: a request for one year and one section of
 * the declarant alone can be granted or denied, not partially granted.
 */
export function canNarrow(requested: Scope): boolean {
  return (
    requested.years.length > 1 ||
    requested.sections.length > 1 ||
    requested.includeSpouses ||
    requested.includeChildren ||
    requested.includeClarifications
  );
}

/** A partial grant of the whole requested scope: the service asks for a grant instead. */
export function isWholeScope(draft: DecisionDraft, requested: Scope): boolean {
  return (
    draft.outcome === 'partial-grant' &&
    draft.scope.years.length > 0 &&
    draft.scope.sections.length > 0 &&
    isSameScope(draft.scope, requested)
  );
}

/**
 * What stops the draft being recorded, as the service's `decisionOf` would refuse it: an
 * outcome; for a partial grant a non-empty scope within, and narrower than, the request; grounds
 * for a partial grant or a denial; reasons of 1 to 4,000 characters.
 */
export function decisionErrors(draft: DecisionDraft, requested: Scope): DecisionErrors {
  const errors: DecisionErrors = {};
  if (!draft.outcome) {
    errors.outcome = m.chooseOutcome;
    return errors;
  }
  if (draft.outcome === 'partial-grant') {
    if (draft.scope.years.length === 0) errors.years = m.chooseYear;
    if (draft.scope.sections.length === 0) errors.sections = m.chooseSection;
    if (!errors.years && !errors.sections) {
      if (!isScopeWithin(draft.scope, requested)) errors.scope = m.scopeExceeds;
      else if (isSameScope(draft.scope, requested)) errors.scope = m.sameAsRequested;
    }
  }
  if (needsGrounds(draft.outcome) && draft.grounds.length === 0) errors.grounds = m.chooseGround;
  const reasons = draft.reasons.trim();
  if (!reasons) errors.reasons = m.enterReasons;
  else if (reasons.length > REASONS_MAX) errors.reasons = m.reasonsTooLong;
  return errors;
}

export function hasErrors(errors: DecisionErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * The `DecisionInput` for a valid draft: a grant of the requested scope sends none and no
 * grounds; a partial grant its narrowed scope and grounds; a denial grounds only.
 */
export function decisionInput(draft: DecisionDraft & { outcome: Outcome }): DecisionInput {
  const reasons = draft.reasons.trim();
  switch (draft.outcome) {
    case 'grant':
      return { outcome: 'grant', reasons };
    case 'partial-grant':
      return {
        outcome: 'partial-grant',
        grantedScope: draft.scope,
        grounds: draft.grounds,
        reasons,
      };
    case 'deny':
      return { outcome: 'deny', grounds: draft.grounds, reasons };
  }
}

/** What a refused decision says, where, and what the officer can do next. */
export interface DecisionFailure {
  title: string;
  message: string;
  /** Field errors to show beside the fields (a 400's `errors[].path`). */
  errors: DecisionErrors;
  /**
   * The request moved on (decided, closed, not under decision): the form cannot succeed, so it
   * offers the request instead of another try.
   */
  stale: boolean;
  /** Sign in again. */
  signIn: boolean;
}

const fieldOf = (path: string): keyof DecisionErrors | null => {
  const head = path.replace(/^\//, '').split(/[./]/)[0];
  if (head === 'grantedScope') return 'scope';
  if (head === 'grounds') return 'grounds';
  if (head === 'reasons') return 'reasons';
  if (head === 'outcome') return 'outcome';
  return null;
};

const FIELD_MESSAGE: Record<keyof DecisionErrors, string> = {
  outcome: m.chooseOutcome,
  years: m.chooseYear,
  sections: m.chooseSection,
  scope: m.scopeRejected,
  grounds: m.groundsRejected,
  reasons: m.reasonsRejected,
};

/** The 400's field errors, in the officer's words. */
function badRequestErrors(problem: AccessProblem): DecisionErrors {
  const errors: DecisionErrors = {};
  for (const each of problem.errors ?? []) {
    const field = fieldOf(each.path);
    if (!field || errors[field]) continue;
    if (field === 'grounds' && problem.code === 'grounds-required') errors.grounds = m.chooseGround;
    else if (field === 'scope' && problem.code === 'scope-exceeds-request') {
      errors.scope = m.scopeExceeds;
    } else if (field === 'scope' && each.message.includes('whole requested scope')) {
      errors.scope = m.sameAsRequested;
    } else errors[field] = FIELD_MESSAGE[field];
  }
  return errors;
}

function badRequestMessage(problem: AccessProblem): string {
  if (problem.code === 'grounds-required') return m.groundsRequired;
  if (problem.code === 'scope-exceeds-request') return m.scopeExceeds;
  const scope = problem.errors?.find((each) => fieldOf(each.path) === 'scope');
  if (scope?.message.includes('whole requested scope')) return m.scopeNotNarrower;
  return m.badRequest;
}

/** Copy a kind of request words its own way (law enforcement: grant before verification). */
export interface DecisionFailureCopy {
  /** A 409 without a code the form knows: the request is not ready for this decision. */
  notUnderDecision?: { title: string; message: string };
}

export function decisionFailure(
  error: ServiceError<AccessProblem>,
  copy: DecisionFailureCopy = {},
): DecisionFailure {
  const failure = (
    title: string,
    message: string,
    more: Partial<DecisionFailure> = {},
  ): DecisionFailure => ({ title, message, errors: {}, stale: false, signIn: false, ...more });
  if (error.kind === 'unauthenticated') {
    return failure(m.notRecordedTitle, m.sessionEnded, { signIn: true });
  }
  if (error.kind === 'unavailable') return failure(m.notRecordedTitle, m.unavailable);
  const { problem } = error;
  if (problem.status === 400) {
    return failure(m.notRecordedTitle, badRequestMessage(problem), {
      errors: badRequestErrors(problem),
    });
  }
  if (problem.status === 403) return failure(m.notRecordedTitle, m.forbidden);
  if (problem.status === 409) {
    if (problem.code === 'request-decided') {
      return failure(m.alreadyDecidedTitle, m.alreadyDecided, { stale: true });
    }
    if (problem.code === 'request-closed') return failure(m.closedTitle, m.closed, { stale: true });
    const notReady = copy.notUnderDecision ?? {
      title: m.notUnderDecisionTitle,
      message: m.notUnderDecision,
    };
    return failure(notReady.title, notReady.message, { stale: true });
  }
  if (problem.status === 404) return failure(m.closedTitle, m.closed, { stale: true });
  return failure(m.notRecordedTitle, m.badRequest);
}
