import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card, CardContent } from './card';
import { REGISTER_KINDS, RegisterTimeline, type RegisterTimelineEntry } from './register-timeline';

const reference = 'ARQ-PSC-2026-0000001-7';

const actors: Partial<Record<(typeof REGISTER_KINDS)[number], string>> = {
  received: 'Mercy Wanjiku Kamau (applicant)',
  withdrawn: 'Mercy Wanjiku Kamau (applicant)',
  downloaded: 'Mercy Wanjiku Kamau (applicant)',
  representations: 'Anne Njeri Mutua (declarant)',
  'package-issued': 'Adili Online',
  expired: 'Adili Online',
};

const everyKind: RegisterTimelineEntry[] = REGISTER_KINDS.map((kind, index) => ({
  id: kind,
  kind,
  at: new Date(Date.UTC(2026, 8, 1 + index, 6)).toISOString(),
  actor: actors[kind] ?? 'Lucy Wambui',
  reference,
  ...(kind === 'decided'
    ? { summary: 'Grounds: Against public interest. Both parties notified.' }
    : {}),
  ...(kind === 'self-access'
    ? { summary: 'DCB-PSC-2026-0150662-4, version 1. Representative: Paul Oduor Otieno.' }
    : {}),
}));

// Who accessed my declaration: the same entries in the declarant's words.
const declarantCopy: RegisterTimelineEntry[] = [
  {
    id: 'n',
    kind: 'notified',
    at: '2026-07-21T07:00:00Z',
    title: 'Mercy Wanjiku Kamau asked to see your declaration',
    actor: 'Notified by PSC',
    reference,
    tone: 'brand',
  },
  {
    id: 'r',
    kind: 'representations',
    at: '2026-07-24T12:10:00Z',
    title: 'You objected',
    actor: 'You',
    reference,
  },
  {
    id: 'd',
    kind: 'decided',
    at: '2026-08-12T08:30:00Z',
    title: 'PSC partially granted access',
    actor: 'Lucy Wambui, access officer',
    reference,
    tone: 'warning',
  },
  {
    id: 'l',
    kind: 'decided',
    at: '2026-08-19T09:45:00Z',
    title: 'Directorate of Criminal Investigations was granted access',
    actor: 'Case DCI/ECO/114/2026',
    reference: 'LEA-PSC-2026-0000003-2',
    tone: 'info',
  },
  {
    id: 'p',
    kind: 'downloaded',
    at: '2026-09-02T14:20:00Z',
    title: 'Mercy Wanjiku Kamau downloaded the package',
    actor: 'Applicant',
    reference,
  },
];

const meta = {
  title: 'Access/RegisterTimeline',
  component: RegisterTimeline,
  args: { entries: everyKind },
} satisfies Meta<typeof RegisterTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Compact density, in a card: every kind with the console's copy. */
export const EveryKind: Story = {
  render: (args) => (
    <Card className="max-w-md">
      <CardContent>
        <RegisterTimeline {...args} />
      </CardContent>
    </Card>
  ),
};

/** List density, flush in a card, grouped by month. */
export const WhoAccessed: Story = {
  args: { entries: declarantCopy, density: 'list', label: 'Who accessed my declaration' },
  render: (args) => (
    <Card className="max-w-2xl overflow-hidden p-0 sm:p-0">
      <RegisterTimeline {...args} />
    </Card>
  ),
};

export const EveryKindAsList: Story = {
  args: { density: 'list' },
  render: (args) => (
    <Card className="max-w-2xl overflow-hidden p-0 sm:p-0">
      <RegisterTimeline {...args} />
    </Card>
  ),
};
