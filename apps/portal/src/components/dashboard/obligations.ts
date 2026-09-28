import type { DeclarationListItem, Obligation } from '../../server/declarations/types';

/**
 * Whether the declarant can start (or continue) a declaration for an obligation (S20): due,
 * overdue and upcoming ones yes; filed and cancelled ones no, with the reason shown.
 */
export type StartAvailability =
  | { kind: 'start' }
  | { kind: 'continue'; declarationId: string }
  | { kind: 'closed'; reason: string };

export const CLOSED_REASONS = {
  filed: 'Already filed. There is nothing more to declare for this obligation.',
  cancelled: 'Cancelled. You do not need to declare for this obligation.',
} as const;

export function startAvailability(
  obligation: Pick<Obligation, 'id' | 'status'>,
  declarations: Pick<DeclarationListItem, 'id' | 'obligationId' | 'status'>[],
): StartAvailability {
  if (obligation.status === 'filed' || obligation.status === 'cancelled') {
    return { kind: 'closed', reason: CLOSED_REASONS[obligation.status] };
  }
  const draft = declarations.find(
    (declaration) =>
      declaration.obligationId === obligation.id &&
      (declaration.status === 'draft' || declaration.status === 'amending'),
  );
  return draft ? { kind: 'continue', declarationId: draft.id } : { kind: 'start' };
}
