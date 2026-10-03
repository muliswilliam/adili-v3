import { ARQ } from '@adili/numbering/references';
import { declarationReferenceParts, type ReferencePart } from '@adili/ui';

/**
 * What each part of an access request reference (`ARQ-PSC-2026-0000151-C`) means: an access
 * request, from that Commission, in the year of submission (ADR-011).
 */
export function accessReferenceParts(commissionName: string): ReferencePart[] {
  return declarationReferenceParts(
    { type: ARQ.name, issuer: commissionName },
    {
      yearMeaning: ARQ.periodName ?? 'Year of submission',
      sequenceMeaning: 'Number within that Commission and year',
    },
  );
}
