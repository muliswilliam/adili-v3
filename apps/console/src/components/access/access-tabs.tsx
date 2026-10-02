import { cn, focusRingInset } from '@adili/ui';
import { Link } from '@tanstack/react-router';

import { messages as m } from './self-access/messages';

/** The pages of the Access requests workspace the tabs move between. */
export type AccessTab = 'requests' | 'certified-copies';

const TABS: {
  tab: AccessTab;
  to: '/access/requests' | '/access/certified-copies';
  label: string;
}[] = [
  { tab: 'requests', to: '/access/requests', label: m.tabRequests },
  { tab: 'certified-copies', to: '/access/certified-copies', label: m.tabCopies },
];

/**
 * The underlined row of the workspace's request types (the prototype's tabs over the queue):
 * links between pages, styled as `TabsTrigger`, the current one marked for assistive technology.
 */
export function AccessTabs({ current }: { current: AccessTab }) {
  return (
    <nav aria-label={m.tabsLabel} className="mb-4">
      <ul className="flex gap-0.5 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(({ tab, to, label }) => (
          <li key={tab}>
            <Link
              to={to}
              aria-current={tab === current ? 'page' : undefined}
              className={cn(
                focusRingInset,
                '-mb-px inline-flex h-10 shrink-0 items-center gap-2 rounded-t-md border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
                tab === current && 'border-foreground text-foreground',
              )}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
