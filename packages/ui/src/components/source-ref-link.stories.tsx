import type { Meta, StoryObj } from '@storybook/react-vite';
import { Building03Icon } from '@hugeicons/core-free-icons';
import { fn } from 'storybook/test';

import { SourceRefLink } from './source-ref-link';

const NONE = { sectionKey: null, personKey: null, itemId: null, fieldPath: null };
const HOUSE = {
  sectionKey: 'assets',
  personKey: 'declarant',
  itemId: '7d3f2a10-4b8e-4c51-9a37-0e6f1c2b9d44',
  fieldPath: null,
};

const meta = {
  title: 'AI/SourceRefLink',
  component: SourceRefLink,
  args: {
    onOpen: fn(),
    sourceRef: HOUSE,
    label: '4-bedroom house on LR 12715/482',
    targetLabel: 'Assets, Building, 4-bedroom house on LR 12715/482, Wanjiku Njeri Kamau',
  },
} satisfies Meta<typeof SourceRefLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Item: Story = {};

/** The item's own type icon in place of the default. */
export const ItemWithTypeIcon: Story = { args: { icon: Building03Icon } };

export const PersonStatement: Story = {
  args: {
    sourceRef: { ...NONE, sectionKey: 'statement', personKey: 'spouse-1' },
    label: 'Amani · statement',
    targetLabel: 'Amani, section 8',
  },
};

export const Field: Story = {
  args: {
    sourceRef: { ...NONE, sectionKey: 'bio', fieldPath: '/personal/designation' },
    label: 'Designation',
    targetLabel: 'Personal and employment details, Designation',
  },
};

export const Section: Story = {
  args: {
    sourceRef: { ...NONE, sectionKey: 'bio' },
    label: 'Personal and employment details',
    targetLabel: undefined,
  },
};

export const LongLabel: Story = {
  args: { label: 'Hardware shop stock, Kamau Hardware Enterprises (BN-4K7Q2P)' },
  decorators: [
    (Story) => (
      <div className="max-w-[260px]">
        <Story />
      </div>
    ),
  ],
};

/** A ref that names nothing is plain text. */
export const Unresolved: Story = { args: { sourceRef: NONE, label: 'Unknown source' } };
