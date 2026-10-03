import { Button, Icon } from '@adili/ui';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { COPY } from '../../notices/copy';
import type { DeclarantNotice } from '../../server/review/types';

/** Where to go to comply: the dashboard's obligations, or the clarifications. */
export function ComplyLink({
  notice,
  variant = 'default',
}: {
  notice: DeclarantNotice;
  variant?: 'default' | 'secondary';
}) {
  return (
    <Button asChild size="sm" variant={variant}>
      <Link to={notice.whatToDo === 'file-declaration' ? '/' : '/clarifications'}>
        {COPY.cta[notice.whatToDo]}
        <Icon icon={ArrowRight01Icon} />
      </Link>
    </Button>
  );
}
