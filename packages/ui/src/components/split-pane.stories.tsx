import type { Meta, StoryObj } from '@storybook/react-vite';

import { SplitPane } from './split-pane';

const meta = {
  title: 'Review/SplitPane',
  component: SplitPane,
  args: {
    label: 'Resize demo panel',
    min: 140,
    max: 400,
    defaultSize: 220,
    className: 'h-[200px] overflow-hidden rounded-xl bg-card ring-1 ring-border',
    mainClassName: 'self-stretch p-3.5 text-[13.5px] text-secondary-foreground',
    sideClassName: 'self-stretch bg-background/60 p-3.5 text-[13.5px] text-secondary-foreground',
    main: 'Main pane: the declaration as filed.',
    side: 'Side pane: flags, registry, clarifications, notes, timeline.',
  },
} satisfies Meta<typeof SplitPane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Drag the handle, or focus it and use the arrow keys, Home and End. */
export const Demo: Story = {};

/** The case view: the handle's pill stays in view while a tall pane scrolls. */
export const CaseView: Story = {
  args: {
    label: 'Resize review panel',
    min: 340,
    max: 720,
    defaultSize: 440,
    className: undefined,
    mainClassName: 'rounded-2xl bg-card p-5 shadow-card',
    sideClassName: 'sticky top-4 rounded-2xl bg-card p-5 shadow-card',
    main: (
      <div className="grid gap-3 text-sm text-secondary-foreground">
        {Array.from({ length: 40 }, (_, index) => (
          <p key={index}>Declaration line {index + 1}</p>
        ))}
      </div>
    ),
    side: <p className="text-sm text-secondary-foreground">Flags · Registry · Notes · Timeline</p>,
  },
};
