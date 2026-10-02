import { TabsLink, TabsNav } from '@adili/ui';
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
 * kind is in its URL), as a `TabsNav`, the current one marked for assistive technology.
 */
export function AccessTabs({ current }: { current: AccessTab }) {
  return (
    <TabsNav aria-label={s.tabsLabel} className="mb-4">
      {TABS.map(({ tab, to, search, label }) => (
        <TabsLink key={tab} asChild current={tab === current}>
          <Link to={to} search={search}>
            {label}
          </Link>
        </TabsLink>
      ))}
    </TabsNav>
  );
}
