import { Badge, cn, Icon } from '@adili/ui';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';

import type { Flag } from '../../../server/review/types';
import { messages as t } from './messages';

const TONES = {
  high: 'destructive',
  medium: 'warning',
  low: 'info',
  info: 'default',
} as const;

const BARS = { high: 3, medium: 2, low: 1 } as const;

/** Three bars, `filled` of them solid: the kit's severity mark, beside the word. */
function Bars({ filled }: { filled: number }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="0.5" y="7" width="3" height="4.5" rx="1" fill="currentColor" />
      <rect
        x="4.5"
        y="4"
        width="3"
        height="7.5"
        rx="1"
        fill="currentColor"
        opacity={filled < 2 ? 0.28 : 1}
      />
      <rect
        x="8.5"
        y="0.5"
        width="3"
        height="11"
        rx="1"
        fill="currentColor"
        opacity={filled < 3 ? 0.28 : 1}
      />
    </svg>
  );
}

/** A flag's severity as text and bars (never colour alone): High, Medium, Low, Info. */
export function SeverityBadge({
  severity,
  size = 'default',
}: {
  severity: Flag['severity'];
  size?: 'default' | 'sm';
}) {
  return (
    <Badge
      variant={TONES[severity]}
      className={cn(
        'font-semibold',
        size === 'sm' ? 'h-[19px] gap-1 px-1.5 text-[11px]' : 'h-[22px] px-2 text-xs',
      )}
    >
      {severity === 'info' ? (
        <Icon icon={InformationCircleIcon} strokeWidth={2.2} className="size-3" />
      ) : (
        <Bars filled={BARS[severity]} />
      )}
      {t.severity[severity]}
    </Badge>
  );
}
