import type { Principal } from '@adili/api-kit';

import { REPORTING_OFFICER_ROLE } from '../commissions/access.js';

/** Who changed a roster: a user, or a Commission's HR system (API channel). */
export interface RosterActor {
  kind: 'user' | 'client';
  /** The user's `sub`, or the HR system's OAuth client id. */
  id: string;
  /** Display name at the time (decision 10): the token's name for users, the client id for HR systems. */
  name: string | null;
}

/**
 * The actor behind a roster change: a user (reporting officer, or any token without a client) by
 * their `sub`, or an HR system by its client id, since its service account's `sub` means nothing
 * to people reading the roster's history.
 */
export function rosterActorOf(principal: Principal): RosterActor {
  if (principal.roles.includes(REPORTING_OFFICER_ROLE) || principal.clientId === null) {
    return { kind: 'user', id: principal.subject, name: principal.name };
  }
  return { kind: 'client', id: principal.clientId, name: principal.clientId };
}

/**
 * The actor as roster events carry it (user story 47: each roster change names who made it):
 * kind and id, no display name.
 */
export interface EventActor extends Record<string, unknown> {
  kind: RosterActor['kind'];
  id: string;
}

export function eventActorOf(actor: Pick<RosterActor, 'kind' | 'id'>): EventActor {
  return { kind: actor.kind, id: actor.id };
}
