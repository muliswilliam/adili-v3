import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SegmentedChoice } from './segmented-choice';
import { SplitPane } from './split-pane';

const pane =
  'h-[260px] rounded-2xl bg-card p-3.5 text-[13.5px] text-secondary-foreground shadow-card';

const meta = {
  title: 'Review/SplitPane',
  component: SplitPane,
  args: {
    main: <div className={pane}>Main pane: the declaration as filed.</div>,
    side: <div className={pane}>Side pane: flags, registry, clarifications, notes, timeline.</div>,
    mainLabel: 'Declaration as filed',
    sideLabel: 'Review tools',
    handleLabel: 'Resize review panel',
    defaultSideWidth: 460,
  },
} satisfies Meta<typeof SplitPane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Drag the handle, or focus it and use the left and right arrow keys, Home and End. */
export const Default: Story = {};

/** Under 800px the panes show one at a time, chosen above them. */
export const Narrow: Story = {
  render: function Narrow(args) {
    const [pane, setPane] = useState<'main' | 'side'>('main');
    return (
      <SplitPane
        {...args}
        narrowPane={pane}
        narrowSwitch={
          <SegmentedChoice
            legend="Show"
            variant="track"
            value={pane}
            onValueChange={(value) => {
              setPane(value as 'main' | 'side');
            }}
            options={[
              { value: 'main', label: 'Declaration' },
              { value: 'side', label: 'Flags and review' },
            ]}
          />
        }
      />
    );
  },
  decorators: [
    (Story) => (
      <div className="max-w-[600px]">
        <Story />
      </div>
    ),
  ],
};
