import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';

import { messages as m } from './messages';

/** "Commissions › {current}" above the screens under the list. */
export function CommissionsBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label={m.breadcrumb}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <li>
          <Link
            to="/commissions"
            className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {m.title}
          </Link>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="size-3.5" />
        </li>
        <li aria-current="page" className="font-medium text-foreground">
          {current}
        </li>
      </ol>
    </nav>
  );
}
