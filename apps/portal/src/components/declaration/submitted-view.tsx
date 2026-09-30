import {
  Badge,
  Button,
  declarationReferenceParts,
  formatDateTime,
  Icon,
  ReferenceChip,
  type ReferencePart,
  VersionBadge,
} from '@adili/ui';
import { findScheme, parse } from '@adili/numbering/references';
import { Clock01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type { Declaration, DeclarationVersion } from '../../server/declarations/types';
import { SlipCard } from './slip-card';

/** Copy of the success page (spec 06 FE-3). */
export const SUBMITTED_COPY = {
  title: 'Declaration submitted',
  received: (commission: string, version: number) =>
    `Received by ${commission}${version > 1 ? `, replacing version ${String(version - 1)}` : ''}. Keep your reference number.`,
  submittedAt: (at: string) => `Submitted ${formatDateTime(at)}`,
  late: 'Filed late',
  home: 'Home',
} as const;

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

export interface SubmittedViewProps {
  declaration: Declaration;
  /** The newest submitted version. */
  version: DeclarationVersion;
}

/**
 * The submission success page (spec 06 FE-3): the reference number with its breakdown and a
 * copy button, the version, when it was submitted and whether late, then the acknowledgement
 * slip as it gets prepared.
 */
export function SubmittedView({ declaration, version }: SubmittedViewProps) {
  return (
    <div>
      <header className="flex flex-col items-center pt-2 pb-[26px] text-center">
        <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-success-subtle text-success">
          <Icon icon={Tick02Icon} className="size-8" strokeWidth={2.4} />
        </span>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">
          {SUBMITTED_COPY.title}
        </h1>
        <p className="mt-1.5 max-w-[480px] text-muted-foreground">
          {SUBMITTED_COPY.received(declaration.commission.name, version.version)}
        </p>
        <div className="mt-[18px]">
          <ReferenceChip
            size="lg"
            reference={version.reference}
            parts={referenceParts(version.reference, declaration.commission.name)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground">
          <VersionBadge version={version.version} />
          <span>{SUBMITTED_COPY.submittedAt(version.submittedAt)}</span>
          {version.late ? (
            <Badge variant="warning">
              <Icon icon={Clock01Icon} />
              {SUBMITTED_COPY.late}
            </Badge>
          ) : null}
        </div>
      </header>
      <SlipCard />
      <div className="mt-6 flex justify-center">
        <Button asChild variant="secondary">
          <Link to="/">{SUBMITTED_COPY.home}</Link>
        </Button>
      </div>
    </div>
  );
}
