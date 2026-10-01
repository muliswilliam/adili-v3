import {
  BankIcon,
  Briefcase01Icon,
  Car01Icon,
  Location01Icon,
  PauseIcon,
} from '@hugeicons/core-free-icons';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { BreakerBadge } from './breaker-badge';
import { Button } from './button';
import { Icon } from './icon';
import { MatchTable } from './match-table';
import { SystemStatusList, SystemStatusRow } from './system-status-row';

const meta = {
  title: 'Registry/SystemStatusRow',
  component: SystemStatusRow,
  args: { name: 'NTSA', icon: Car01Icon, status: 'matched', count: 1 },
  // A row is an <li>, so each story puts it in a list unless it renders its own.
  decorators: [
    (Story, { parameters }) =>
      parameters.ownList ? (
        <Story />
      ) : (
        <SystemStatusList label="Registry checks" className="max-w-[620px]">
          <Story />
        </SystemStatusList>
      ),
  ],
} satisfies Meta<typeof SystemStatusRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const vehicles = (
  <MatchTable
    system="NTSA"
    rows={[
      {
        id: 'KCN 331Z',
        record: 'KCN 331Z',
        recordDetail: 'Isuzu NQR · 2017 · registered 21 Aug 2017',
        relation: 'matched',
        declared: 'Vehicle',
        declaredDetail: 'Isuzu NQR lorry, KCN 331Z',
      },
      {
        id: 'KDK 482M',
        record: 'KDK 482M',
        recordDetail: 'Toyota Land Cruiser Prado · 2021 · registered 14 Jun 2024',
        relation: 'not-declared',
      },
    ]}
  />
);

export const Matched: Story = { args: { checkedAt: '2026-09-02T11:31:00Z' } };

export const Expanded: Story = {
  args: {
    status: 'mismatched',
    count: 1,
    checkedAt: '2026-09-02T11:31:00Z',
    defaultExpanded: true,
    children: vehicles,
  },
};

export const Unavailable: Story = {
  args: { name: 'ArdhiSasa', icon: Location01Icon, status: 'unavailable' },
};

export const NotChecked: Story = {
  args: { name: 'BRS', icon: Briefcase01Icon, status: 'not-checked' },
};

export const NoId: Story = {
  args: { name: 'KRA', icon: BankIcon, status: 'no-id', personName: 'Amani' },
};

export const Checking: Story = { args: { checking: true, children: vehicles } };

export const WithAction: Story = {
  args: {
    name: 'NTSA TIMS',
    status: undefined,
    description: 'Vehicles by owner',
    badge: <BreakerBadge state="open" />,
    action: (
      <Button variant="secondary" size="sm">
        <Icon icon={PauseIcon} />
        Pause
      </Button>
    ),
    children: (
      <p className="text-[13px] text-muted-foreground">
        Opens after 5 failures in a row, tries again after 30 seconds.
      </p>
    ),
  },
};

export const EveryStatus: Story = {
  parameters: { ownList: true },
  render: () => (
    <SystemStatusList
      label="Registry checks for Wanjiku Njeri Kamau"
      className="max-w-[620px]"
      header={
        <div className="min-w-0">
          <div className="text-sm font-semibold">Wanjiku Njeri Kamau</div>
          <div className="text-[13px] text-muted-foreground">Declarant</div>
        </div>
      }
    >
      <SystemStatusRow
        name="KRA"
        icon={BankIcon}
        status="matched"
        description="PIN on record, compliant, income within 25%"
      >
        <p className="text-[13px] text-muted-foreground">KRA record</p>
      </SystemStatusRow>
      <SystemStatusRow name="NTSA" icon={Car01Icon} status="mismatched" count={1} defaultExpanded>
        {vehicles}
      </SystemStatusRow>
      <SystemStatusRow name="ArdhiSasa" icon={Location01Icon} status="unavailable" />
      <SystemStatusRow name="BRS" icon={Briefcase01Icon} status="not-checked" />
      <SystemStatusRow name="KRA" icon={BankIcon} status="no-id" personName="Amani" />
    </SystemStatusList>
  ),
};
