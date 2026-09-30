import type { ClarificationStatus } from '../server/review/types';

export interface ClarificationActions {
  resolve: boolean;
  followUp: 'hidden' | 'enabled' | 'disabled';
  withdraw: boolean;
}

/**
 * The actions on a clarification (spec 07a S15). Only the case's assignee acts (a supervisor
 * reassigns first). Once the declarant has responded the reviewer reads the response, then
 * resolves it or raises a follow-up (while the six-month window is open). Before a response the
 * only action is to withdraw one issued in error; an unanswered one past its due date goes to
 * enforcement (spec 08), not here.
 */
export function clarificationActions({
  status,
  mine,
  windowOpen,
}: {
  status: ClarificationStatus;
  mine: boolean;
  windowOpen: boolean;
}): ClarificationActions {
  if (!mine) return { resolve: false, followUp: 'hidden', withdraw: false };
  const responded = status === 'responded';
  return {
    resolve: responded,
    followUp: responded ? (windowOpen ? 'enabled' : 'disabled') : 'hidden',
    withdraw: status === 'issued' || status === 'overdue',
  };
}
