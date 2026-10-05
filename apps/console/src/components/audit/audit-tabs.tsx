import { Icon, TabsLink, TabsNav } from '@adili/ui';
import { FileSearchIcon, LockKeyIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { messages as t } from './messages';

/** The audit trail's tabs, under the page title: its events and the integrity of its chains. */
export function AuditTabs({ current }: { current: 'events' | 'integrity' }) {
  return (
    <TabsNav aria-label={t.tabsLabel} className="mb-[18px]">
      <TabsLink asChild current={current === 'events'}>
        <Link to="/audit">
          <Icon icon={FileSearchIcon} />
          {t.eventsTab}
        </Link>
      </TabsLink>
      <TabsLink asChild current={current === 'integrity'}>
        <Link to="/audit/integrity">
          <Icon icon={LockKeyIcon} />
          {t.integrityTab}
        </Link>
      </TabsLink>
    </TabsNav>
  );
}
