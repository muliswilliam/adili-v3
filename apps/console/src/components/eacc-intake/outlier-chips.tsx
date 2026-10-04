import { Badge, Icon } from '@adili/ui';
import { Flag02Icon } from '@hugeicons/core-free-icons';

import type { IntakeRow } from '../../server/reporting/types';
import { messages as m } from './messages';

/** Form M's declaration sections, in the form's order, as the intake keys their rates. */
export const INTAKE_SECTIONS = ['initial', 'biennial', 'final'] as const;

/** A report's outliers as amber chips with a flag ("Low biennial rate"); none renders nothing. */
export function OutlierChips({ outliers }: { outliers: IntakeRow['outliers'] }) {
  if (outliers.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {outliers.map((outlier) => (
        <li key={outlier}>
          <Badge variant="warning" className="pl-[7px]">
            <Icon icon={Flag02Icon} />
            {m.outlier[outlier]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
