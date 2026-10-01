import { CheckmarkBadge01Icon } from '@hugeicons/core-free-icons';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icon } from './icon';
import { IconTile } from './icon-tile';

const TONES = ['default', 'success', 'warning', 'destructive', 'info', 'brand', 'ai'] as const;

const meta = {
  title: 'Primitives/IconTile',
  component: IconTile,
  args: { tone: 'brand', children: <Icon icon={CheckmarkBadge01Icon} /> },
} satisfies Meta<typeof IconTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every `Badge` tone, at the default 34px and at `sm` (32px). */
export const EveryTone: Story = {
  render: () => (
    <div className="grid gap-4">
      {(['default', 'sm'] as const).map((size) => (
        <div key={size} className="flex items-start gap-4">
          <span className="w-16 pt-2 text-sm text-muted-foreground">{size}</span>
          {TONES.map((tone) => (
            <figure key={tone} className="grid justify-items-center gap-1">
              <IconTile tone={tone} size={size}>
                <Icon icon={CheckmarkBadge01Icon} />
              </IconTile>
              <figcaption className="text-xs text-muted-foreground">{tone}</figcaption>
            </figure>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** `art`: white with a brand icon, on the photo panel beside the signed-out pages. */
export const Art: Story = {
  args: { tone: 'art', size: 'sm' },
  decorators: [
    (Story) => (
      <div className="w-fit rounded-xl bg-art p-4">
        <Story />
      </div>
    ),
  ],
};
