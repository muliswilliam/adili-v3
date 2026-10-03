import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { useAutosave } from '../lib/use-autosave';
import { Button } from './button';
import { type FormMDeclarationSection, type FormMNonFiler, FormMSection } from './form-m-section';

const NON_FILERS: FormMNonFiler[] = [
  {
    obligationId: 'o-1',
    name: 'Jane Wanjiru',
    designation: 'Senior Clerical Officer',
    identifier: 'PSC/2025/0412',
    date: '2025-09-01',
    actionTaken: 'warning',
    complied: 'pending',
    remarks: 'Warning issued 12 May 2026. Response due 26 May.',
  },
  {
    obligationId: 'o-2',
    name: 'Peter Otieno',
    designation: 'Driver',
    identifier: 'PSC/2025/0533',
    date: '2025-11-14',
    actionTaken: 'none',
    complied: 'no',
    remarks: 'No action taken yet.',
  },
  {
    obligationId: 'o-3',
    name: 'Amina Hassan',
    designation: 'Human Resource Officer II',
    identifier: 'PSC/2026/0018',
    date: '2026-01-20',
    actionTaken: 'notice-to-comply',
    complied: 'yes',
    remarks: 'Declared on 3 April 2026 after a notice to comply.',
  },
];

const INITIAL: FormMDeclarationSection = {
  expected: 64,
  declared: 61,
  notDeclared: 3,
  nonFilers: NON_FILERS,
};

const meta = {
  title: 'Reporting/FormMSection',
  component: FormMSection,
  args: { section: 'initial', data: INITIAL },
  decorators: [
    (Story) => (
      <div className="max-w-[920px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FormMSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadOnly: Story = {};

function EditableSection() {
  const [rows, setRows] = useState(NON_FILERS);
  const autosave = useAutosave<FormMNonFiler[]>(
    () => new Promise((resolve) => setTimeout(resolve, 600)),
  );
  return (
    <FormMSection
      section="initial"
      data={{ ...INITIAL, nonFilers: rows }}
      autosave={autosave}
      remarkEditedBy={(row) => (row.obligationId === 'o-1' ? 'Samuel Njoroge' : null)}
      onRemarkChange={(row, remarks) => {
        const next = rows.map((each) =>
          each.obligationId === row.obligationId ? { ...each, remarks } : each,
        );
        setRows(next);
        autosave.change(next);
      }}
    />
  );
}

export const EditableRemarks: Story = { render: () => <EditableSection /> };

export const Saving: Story = {
  args: {
    onRemarkChange: () => undefined,
    autosave: { status: 'saving', savedAt: null, failure: null, flush: () => undefined },
  },
};

export const LongListPaged: Story = {
  args: {
    section: 'biennial',
    data: { expected: 4_812, declared: 3_406, notDeclared: 1_406, nonFilers: NON_FILERS },
    nonFilersTotal: 1_406,
    firstRowNumber: 11,
    pagination: (
      <div className="flex items-center justify-between border-t px-4 py-3 text-[13px] text-muted-foreground">
        <span>11-13 of 1,406</span>
        <span className="flex gap-2">
          <Button size="xs" variant="secondary">
            Previous
          </Button>
          <Button size="xs" variant="secondary">
            Next
          </Button>
        </span>
      </div>
    ),
  },
};

export const FinalSection: Story = {
  args: {
    section: 'final',
    data: {
      expected: 12,
      declared: 7,
      notDeclared: 5,
      nonFilers: NON_FILERS.slice(0, 2).map((row) => ({ ...row, date: '2026-03-31' })),
    },
  },
};

export const NoneToList: Story = {
  args: { data: { expected: 18, declared: 18, notDeclared: 0, nonFilers: [] } },
};

export const NoBiennialCycle: Story = {
  args: {
    section: 'biennial',
    data: { expected: 0, declared: 0, notDeclared: 0, nonFilers: [], noCycleInPeriod: true },
  },
};

export const Phone: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-[360px]">
        <Story />
      </div>
    ),
  ],
  args: { onRemarkChange: () => undefined },
};
