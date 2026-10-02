import { cn, focusRingInset } from '@adili/ui';
import { Link } from '@tanstack/react-router';

import { messages as m } from './messages';
import type { QueueTab } from './queue-query';
import { messages as s } from './self-access/messages';

/** The pages of the Access requests workspace the tabs move between. */
export type AccessTab = QueueTab | 'certified-copies';

const TABS: {
  tab: AccessTab;
  to: '/access/requests' | '/access/certified-copies';
  search?: { kind: 'form-k' | 'lea' };
  label: string;
}[] = [
  { tab: 'all', to: '/access/requests', label: m.tabs.all },
  { tab: 'form-k', to: '/access/requests', search: { kind: 'form-k' }, label: m.tabs['form-k'] },
  { tab: 'lea', to: '/access/requests', search: { kind: 'lea' }, label: m.tabs.lea },
  { tab: 'certified-copies', to: '/access/certified-copies', label: s.tabCopies },
];

/**
 * The underlined row of the workspace's request types (the prototype's tabs over the queue):
 * every request, Form K, law enforcement, certified copies. Links between pages (the queue's
 * kind is in its URL), styled as `TabsTrigger`, the current one marked for assistive technology.
 */
export function AccessTabs({ current }: { current: AccessTab }) {
  return (
    <nav aria-label={s.tabsLabel} className="mb-4">
      <ul className="flex gap-0.5 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(({ tab, to, search, label }) => (
          <li key={tab}>
            <Link
              to={to}
              search={search}
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
