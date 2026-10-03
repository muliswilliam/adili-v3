import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { AiLabel } from './ai-label';
import { Alert, AlertDescription } from './alert';
import { Button } from './button';
import { AutosaveFailure, useAutosave } from '../lib/use-autosave';
import {
  NATIONAL_REPORT_NARRATIVE_SECTIONS,
  NarrativeEditor,
  narrativeSections,
  type NarrativeValue,
} from './narrative-editor';

const SECTIONS = NATIONAL_REPORT_NARRATIVE_SECTIONS;

const DRAFT: NarrativeValue = {
  overview: [
    {
      id: 'p1',
      text: '41 of 47 Commissions submitted Form M for FY 2025/2026; 6 of them reported after the due date.',
    },
    {
      id: 'p2',
      text: 'Across the reporting Commissions, 187,204 of 216,950 expected declarations were made, a national filing rate of 86.3%.',
      aiDraft: true,
    },
  ],
  findings: [
    {
      id: 'p3',
      text: 'Section rates fell below the 80% threshold in 9 cases. The lowest is the County Public Service Board of Lamu at 41.2%.',
    },
  ],
  recommendations: [],
};

function Editable(props: { initial?: NarrativeValue; fail?: boolean; refuse?: boolean }) {
  const [value, setValue] = useState(props.initial ?? DRAFT);
  const autosave = useAutosave<Record<string, string>>(
    () =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          if (props.refuse) reject(new AutosaveFailure('error', 'ncr-approved'));
          else if (props.fail) reject(new Error('offline'));
          else resolve();
        }, 600);
      }),
  );
  return (
    <NarrativeEditor
      sections={SECTIONS}
      value={value}
      autosave={autosave}
      onChange={(next, change) => {
        setValue(next);
        if (change.textChanged) autosave.change(narrativeSections(next, SECTIONS));
      }}
      messages={{ error: 'This report was approved meanwhile: the narrative is frozen' }}
      paragraphMeta={(paragraph) =>
        paragraph.aiDraft ? (
          <AiLabel text="AI draft" size="sm" />
        ) : paragraph.id === 'p1' ? (
          <AiLabel edited editedText="Edited" size="sm" />
        ) : null
      }
      actions={
        <Button size="sm" variant="secondary">
          Draft narrative
        </Button>
      }
    />
  );
}

const meta = {
  title: 'Reporting/NarrativeEditor',
  component: NarrativeEditor,
  args: { sections: SECTIONS, value: DRAFT },
  decorators: [
    (Story) => (
      <div className="max-w-[920px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NarrativeEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = { render: () => <Editable /> };

export const Empty: Story = {
  render: () => <Editable initial={{ overview: [], findings: [], recommendations: [] }} />,
};

export const SaveFails: Story = { render: () => <Editable fail /> };

export const SaveRefused: Story = { render: () => <Editable refuse /> };

export const WithNotice: Story = {
  args: {
    onChange: () => undefined,
    notice: (
      <Alert variant="destructive">
        <AlertDescription>
          The draft referenced a figure that is not in the table and was discarded.
        </AlertDescription>
      </Alert>
    ),
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, readOnlyNote: 'Written by the analyst' },
};

export const Approved: Story = {
  args: { readOnly: true, readOnlyNote: 'Frozen at approval' },
};
