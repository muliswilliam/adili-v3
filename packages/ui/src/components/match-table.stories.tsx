import { Alert02Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from './badge';
import { Button } from './button';
import { Icon } from './icon';
import { MatchTable, type MatchTableRow } from './match-table';

const goToItem = (
  <Button variant="link" size="xs" className="h-auto px-0 text-[12.5px]">
    Go to item
  </Button>
);

const parcels: MatchTableRow[] = [
  {
    id: 'NYERI/MUKURWE-INI/1187',
    record: 'NYERI/MUKURWE-INI/1187',
    recordDetail: 'Nyeri · 0.2 ha · freehold · registered 2 Oct 2012',
    relation: 'matched',
    declared: 'Land',
    declaredDetail: '0.5 acre plot, NYERI/MUKURWE-INI/1187',
    action: goToItem,
  },
  {
    id: 'LR 12715/482',
    record: 'LR 12715/482',
    recordDetail: 'Machakos · 0.05 ha · leasehold · registered 19 May 2016',
    relation: 'matched',
    declared: 'Building',
    declaredDetail: '4-bedroom house on LR 12715/482',
    action: goToItem,
  },
  {
    id: 'KAJIADO/KITENGELA/48213',
    record: 'KAJIADO/KITENGELA/48213',
    recordDetail: 'Kajiado · 0.05 ha · freehold · registered 3 Feb 2025',
    relation: 'not-declared',
  },
];

const meta = {
  title: 'Registry/MatchTable',
  component: MatchTable,
  args: { system: 'ArdhiSasa', rows: parcels },
  decorators: [
    (Story) => (
      <div className="max-w-[640px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MatchTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MatchedAndNotDeclared: Story = {};

export const NotInRegistry: Story = {
  args: {
    system: 'BRS',
    rows: [
      {
        id: 'BN-4K7Q2P',
        record: 'BN-4K7Q2P',
        recordDetail: 'BRS has no company with this registration number',
        relation: 'not-in-registry',
        declared: 'Other',
        declaredDetail: 'Hardware shop stock, Kamau Hardware Enterprises (BN-4K7Q2P)',
        action: goToItem,
      },
    ],
  },
};

export const OnASupplierList: Story = {
  args: {
    system: 'BRS',
    rows: [
      {
        id: 'PVT-AAB7Q9',
        record: 'Kamau Medical Supplies Ltd',
        recordDetail: 'PVT-AAB7Q9 · director · 60% of shares',
        recordNote: (
          <Badge variant="destructive">
            <Icon icon={Alert02Icon} strokeWidth={2.2} />
            On the KEMSA supplier list
          </Badge>
        ),
        relation: 'not-declared',
      },
    ],
  },
};

export const ComparedValues: Story = {
  args: {
    system: 'KRA',
    messages: {
      declaredColumn: 'Compared with the declaration',
      caption: () =>
        'KRA record compared with the declaration. Income is shown as a percentage only.',
    },
    rows: [
      {
        id: 'pin',
        record: 'PIN',
        declared: (
          <Badge variant="success">
            <Icon icon={Tick02Icon} strokeWidth={2.2} />
            On record
          </Badge>
        ),
      },
      {
        id: 'compliance',
        record: 'Tax compliance',
        declared: (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <Badge variant="success">Compliant</Badge>
            <span className="text-[12.5px] font-normal text-muted-foreground">
              certificate valid until 31 Mar 2027
            </span>
          </span>
        ),
      },
      {
        id: 'income',
        record: 'Income declared to KRA',
        declared: (
          <span className="font-semibold text-warning">
            KRA-declared income differs by 38% from the income declared here.
          </span>
        ),
      },
    ],
  },
};

export const NoRecords: Story = { args: { system: 'NTSA', rows: [] } };
