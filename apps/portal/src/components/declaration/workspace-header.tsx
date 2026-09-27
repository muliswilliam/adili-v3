import { formatDate, Icon, Tooltip } from '@adili/ui';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';

import type { Declaration } from '../../server/declarations/types';
import { OBLIGATION_TYPE_LABELS } from './labels';

export const HEADER_COPY = {
  statementDate: 'The date your financial position is declared as at.',
  incomePeriod:
    'Income you received between these dates. For an initial declaration, the year ending on your appointment date.',
  assumed:
    'We assumed the start because we hold no previous declaration for you. If you declared before on paper, use the same period.',
} as const;

/** "Biennial declaration · Teachers Service Commission". */
export function declarationName(declaration: Pick<Declaration, 'type' | 'commission'>) {
  return `${OBLIGATION_TYPE_LABELS[declaration.type]} declaration · ${declaration.commission.name}`;
}

function Term({ label, explanation }: { label: string; explanation: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip content={explanation}>
        <button
          type="button"
          aria-label={`What is ${label.toLowerCase()}?`}
          className="inline-grid size-5 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Icon icon={InformationCircleIcon} className="size-4" />
        </button>
      </Tooltip>
    </span>
  );
}

/**
 * The header on every workspace screen: which declaration this is, the screen's heading, and
 * the statement date and income period with their explanations.
 */
export function WorkspaceHeader({
  declaration,
  title,
}: {
  declaration: Declaration;
  title: string;
}) {
  const { incomePeriod } = declaration;
  return (
    <header className="grid gap-1.5">
      <p className="text-sm font-medium text-muted-foreground">{declarationName(declaration)}</p>
      <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.015em]">{title}</h1>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-secondary-foreground">
        <Term label="Statement date" explanation={HEADER_COPY.statementDate} />
        <span className="font-medium text-foreground">{formatDate(declaration.statementDate)}</span>
        <span aria-hidden="true">·</span>
        <Term label="Income" explanation={HEADER_COPY.incomePeriod} />
        <span className="font-medium text-foreground">
          {formatDate(incomePeriod.from)} to {formatDate(incomePeriod.to)}
        </span>
      </p>
      {incomePeriod.fromSource === 'assumed' ? (
        <p className="max-w-prose text-[13px] text-muted-foreground">{HEADER_COPY.assumed}</p>
      ) : null}
    </header>
  );
}
