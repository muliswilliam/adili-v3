import type { Meta, StoryObj } from '@storybook/react-vite';

import { formatNumber } from '../lib/format-number';
import { UNSHOWN_FIGURE_KINDS, SuppressionLegend, SuppressionMarker } from './suppression-marker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

const meta = {
  title: 'Open data/SuppressionMarker',
  component: SuppressionMarker,
  args: { kind: 'suppressed' },
} satisfies Meta<typeof SuppressionMarker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Suppressed: Story = {};

export const Complementary: Story = { args: { kind: 'complementary' } };

export const NotReported: Story = { args: { kind: 'not-reported' } };

export const NotCollected: Story = { args: { kind: 'not-collected' } };

const KIND_NOTES = {
  suppressed: 'Suppressed: under 10 officers, or protects a total',
  complementary: 'Known complementary: protects a total',
  'not-reported': 'Commission did not report',
  'not-collected': 'Not collected yet (access requests)',
};

export const EveryKind: Story = {
  render: () => (
    <div className="grid gap-2.5 text-sm text-muted-foreground">
      {UNSHOWN_FIGURE_KINDS.map((kind) => (
        <div key={kind} className="flex items-center gap-2.5">
          <SuppressionMarker kind={kind} />
          {KIND_NOTES[kind]}
        </div>
      ))}
    </div>
  ),
};

export const Legend: Story = {
  render: () => <SuppressionLegend cellsSuppressed={6} />,
};

export const LegendWithKeys: Story = {
  render: () => <SuppressionLegend cellsSuppressed={6} keys={['suppressed', 'not-collected']} />,
};

export const SwahiliLegend: Story = {
  render: () => (
    <SuppressionLegend
      cellsSuppressed={6}
      keys={['suppressed', 'not-collected']}
      messages={{
        sentence: (threshold) =>
          `Takwimu za maafisa chini ya ${threshold}, na zinazoweza kuzifichua, hazionyeshwi ili kulinda faragha.`,
        cellsSuppressed: (count) => `${formatNumber(count)} vimefichwa`,
        keys: { suppressed: () => 'Kulinda faragha', 'not-collected': () => 'Bado hazikusanywi' },
      }}
      markerMessages={{ 'not-collected': { short: () => 'Hazikusanywi' } }}
    />
  ),
};

interface Row {
  commission: string;
  figures?: (number | string | null)[];
  notReported?: boolean;
}

const ROWS: Row[] = [
  { commission: 'Public Service Commission', figures: [4210, 3974, '94.4%'] },
  { commission: 'Tana River CPSB', figures: [null, null, null] },
  { commission: 'Lamu CPSB', figures: [null, null, null] },
  { commission: 'Judicial Service Commission', notReported: true },
  { commission: 'Mombasa CPSB', figures: [612, 561, '91.7%'] },
];

export const InATable: Story = {
  render: () => (
    <div className="grid max-w-[760px] gap-3 rounded-xl bg-card p-4 shadow-card">
      <SuppressionLegend cellsSuppressed={6} />
      <Table caption="Final declarations by Commission, FY 2025/2026">
        <TableHeader>
          <TableRow>
            <TableHead>Commission</TableHead>
            <TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Filed</TableHead>
            <TableHead className="text-right">Filing rate</TableHead>
            <TableHead className="text-right">Access requests</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.commission}>
              <TableCell className="font-medium">{row.commission}</TableCell>
              {row.notReported ? (
                <TableCell colSpan={4}>
                  <SuppressionMarker kind="not-reported" />
                </TableCell>
              ) : (
                <>
                  {row.figures?.map((value, index) => (
                    <TableCell key={index} className="text-right tabular-nums">
                      {value == null ? (
                        <SuppressionMarker />
                      ) : typeof value === 'number' ? (
                        formatNumber(value)
                      ) : (
                        value
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <SuppressionMarker kind="not-collected" />
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};
