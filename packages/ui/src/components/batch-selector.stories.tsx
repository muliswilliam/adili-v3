import type { Meta, StoryObj } from '@storybook/react-vite';

import { BatchSelector } from './batch-selector';
import { FormField } from './form-field';
import { Select, SelectItem } from './select';

const FILTERS = (
  <>
    <FormField label="Cycle">
      <Select defaultValue="2026">
        <SelectItem value="2026">Cycle 2026</SelectItem>
        <SelectItem value="2024">Cycle 2024</SelectItem>
      </Select>
    </FormField>
    <FormField label="Type">
      <Select defaultValue="all">
        <SelectItem value="all">All types</SelectItem>
        <SelectItem value="biennial">Biennial</SelectItem>
      </Select>
    </FormField>
    <FormField label="Priority band">
      <Select defaultValue="low" disabled>
        <SelectItem value="low">Low only</SelectItem>
      </Select>
    </FormField>
    <FormField label="Reporting entity">
      <Select defaultValue="all">
        <SelectItem value="all">All reporting entities</SelectItem>
      </Select>
    </FormField>
  </>
);

const noop = () => undefined;

const meta = {
  title: 'Determinations/BatchSelector',
  component: BatchSelector,
  args: {
    filters: FILTERS,
    phase: 'ready',
    eligible: 1240,
    excluded: 25,
    onApprove: noop,
    onResume: noop,
    onStop: noop,
    onReset: noop,
  },
} satisfies Meta<typeof BatchSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const NoProposalsYet: Story = {
  args: { phase: 'pending', eligible: 0, windowClosesAt: '2026-09-30T09:00:00.000Z' },
};

export const NothingLeft: Story = { args: { eligible: 0 } };

export const Running: Story = {
  args: { phase: 'running', progress: { chunk: 5, chunks: 13, approved: 500, total: 1240 } },
};

export const Done: Story = {
  args: {
    phase: 'done',
    progress: { chunk: 13, chunks: 13, approved: 1240, total: 1240 },
    references: { first: 'CMP-TSC-2026-0000100-1', last: 'CMP-TSC-2026-0001339-K' },
  },
};

export const Stopped: Story = {
  args: {
    phase: 'stopped',
    progress: { chunk: 3, chunks: 13, approved: 300, total: 1240 },
    references: { first: 'CMP-TSC-2026-0000100-1', last: 'CMP-TSC-2026-0000399-4' },
    stoppedReason: 'The numbering service did not respond.',
  },
};
