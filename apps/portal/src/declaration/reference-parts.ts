import { findScheme, parse } from '@adili/numbering/references';
import { declarationReferenceParts, type ReferencePart } from '@adili/ui';

/**
 * What each part of a declaration reference means, with the type's name from the numbering
 * scheme registry and the issuer's from the Commission; none when the reference does not parse.
 */
export function referenceParts(
  reference: string,
  commissionName: string,
): ReferencePart[] | undefined {
  try {
    const scheme = findScheme(parse(reference).scheme);
    return scheme
      ? declarationReferenceParts({ type: scheme.name, issuer: commissionName })
      : undefined;
  } catch {
    return undefined;
  }
}
