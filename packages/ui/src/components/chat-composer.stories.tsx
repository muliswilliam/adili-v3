import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChatComposer } from './chat-composer';

const meta = {
  title: 'AI/ChatComposer',
  component: ChatComposer,
  args: { onSend: () => undefined },
  decorators: [
    (Story) => (
      <div className="max-w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Enter sends; Shift+Enter adds a line. */
export const Empty: Story = {};

/** A long question grows the box up to 120px, then scrolls. */
export const Drafted: Story = {
  args: {
    value:
      'I own a plot in Kimumu with my brother and a car with my wife. Do I declare both at their whole value, or only my share of each?',
  },
};

/** An answer is on its way: typing goes on, sending waits. */
export const Busy: Story = { args: { busy: true, value: 'And for land?' } };

export const Disabled: Story = { args: { disabled: true } };
