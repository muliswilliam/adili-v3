import { Icon, TabsLink, TabsNav } from '@adili/ui';
import { File01Icon, InboxIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { messages as m } from './messages';

/**
 * The tabs of EACC's compliance reports, under the page title: the intake (#230) and the
 * national consolidated report (#233). The year on show goes along.
 */
export function ComplianceReportsTabs({ current, fy }: { current: 'intake' | 'ncr'; fy?: number }) {
  return (
    <TabsNav aria-label={m.tabsLabel} className="mb-[18px]">
      <TabsLink asChild current={current === 'intake'}>
        <Link to="/eacc/reports" search={{ fy }}>
          <Icon icon={InboxIcon} />
          {m.intakeTab}
        </Link>
      </TabsLink>
      <TabsLink asChild current={current === 'ncr'}>
        <Link to="/eacc/reports/ncr" search={{ fy }}>
          <Icon icon={File01Icon} />
          {m.ncrTab}
        </Link>
      </TabsLink>
    </TabsNav>
  );
}
