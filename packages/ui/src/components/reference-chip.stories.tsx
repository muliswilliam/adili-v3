import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { declarationReferenceParts, ReferenceChip } from './reference-chip';
import { ToastProvider } from './toast';

const meta = {
  title: 'Verification/ReferenceChip',
  component: ReferenceChip,
  args: {
    reference: 'DCB-TSC-2027-0012345-K',
    // The portal passes the numbering scheme registry's names.
    parts: declarationReferenceParts({
      type: 'Biennial declaration',
      issuer: 'Teachers Service Commission',
    }),
  },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof ReferenceChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const BreakdownOpen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'What does this reference mean?' }),
    );
  },
};

export const Small: Story = {
  args: {
    size: 'sm',
    reference: 'DCI-TSC-2026-0012345-8',
    parts: declarationReferenceParts({
      type: 'Initial declaration',
      issuer: 'Teachers Service Commission',
    }),
  },
};

/** Without registry names the chip is the reference and its copy button. */
export const WithoutBreakdown: Story = { args: { parts: undefined } };

export const TextOnly: Story = { args: { parts: undefined, copyable: false } };
