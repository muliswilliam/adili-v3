import { Icon } from '@adili/ui';
import { ViewIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { messages as m } from './messages';

/**
 * Above a Commission's roster records opened from the Commissions workspace (the prototype's
 * `.banner.audit`): reads of personal data by national staff are audited, and the way back.
 */
export function AuditBanner({ slug }: { slug: string }) {
  return (
    <div
      role="note"
      className="mb-[18px] flex flex-wrap items-center gap-3 rounded-lg bg-ai-subtle px-4 py-3 text-sm text-ai-subtle-foreground [&>svg]:size-[17px] [&>svg]:shrink-0"
    >
      <Icon icon={ViewIcon} />
      <span className="min-w-[200px] flex-1">{m.auditedBanner}</span>
      <Link
        to="/commissions/$slug"
        params={{ slug }}
        className="rounded-sm font-medium underline decoration-current/40 underline-offset-[3px] outline-none hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {m.backToCommission}
      </Link>
    </div>
  );
}
