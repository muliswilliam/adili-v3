import type { Meta, StoryObj } from '@storybook/react-vite';

import { SuppressionLegend, SuppressionMarker } from './suppression-marker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

const meta = {
  title: 'Open data/SuppressionMarker',
  component: SuppressionMarker,
  args: { kind: 'under-threshold' },
} satisfies Meta<typeof SuppressionMarker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnderThreshold: Story = {};

export const Complementary: Story = { args: { kind: 'complementary' } };

export const NotReported: Story = { args: { kind: 'not-reported' } };

export const EveryKind: Story = {
  render: () => (
    <div className="grid gap-2.5 text-sm text-muted-foreground">
      <div className="flex items-center gap-2.5">
        <SuppressionMarker />
        Under 10 officers
      </div>
      <div className="flex items-center gap-2.5">
        <SuppressionMarker kind="complementary" />
        Complementary: protects a total
      </div>
      <div className="flex items-center gap-2.5">
        <SuppressionMarker kind="not-reported" />
        Commission did not report
      </div>
    </div>
  ),
};

export const Legend: Story = {
  render: () => <SuppressionLegend hiddenCount={6} />,
};

export const CompactLegend: Story = {
  render: () => <SuppressionLegend compact hiddenCount={6} />,
};

export const SwahiliLegend: Story = {
  render: () => (
    <SuppressionLegend
      messages={{
        underThreshold: (threshold) => `‹${threshold}`,
        underThresholdText: (threshold) => `Maafisa chini ya ${threshold}, haionyeshwi`,
        underThresholdTitle: (threshold) => `Maafisa chini ya ${threshold}`,
        complementary: 'Imefichwa',
        complementaryText: 'Imefichwa ili kulinda kikundi kidogo',
        complementaryTitle: 'Imefichwa ili kikundi kidogo kisitambulike',
        legend: (threshold) =>
          `Visanduku vinavyotokana na maafisa chini ya ${threshold} havionyeshwi ili kulinda faragha.`,
        hiddenCount: (count) => `${count} vimefichwa`,
        underThresholdKey: (threshold) => `Chini ya ${threshold}`,
        complementaryKey: 'Kinga ya jumla',
      }}
      hiddenCount={6}
    />
  ),
};

const ROWS = [
  { commission: 'Public Service Commission', expected: 4210, filed: 3974, rate: '94.4%' },
  { commission: 'Tana River CPSB', expected: null, filed: null, rate: null },
  { commission: 'Lamu CPSB', expected: null, filed: null, rate: null, complementary: true },
  { commission: 'Judicial Service Commission', notReported: true },
  { commission: 'Mombasa CPSB', expected: 612, filed: 561, rate: '91.7%' },
];

export const InATable: Story = {
  render: () => (
    <div className="grid max-w-[720px] gap-3 rounded-xl bg-card p-4 shadow-card">
      <SuppressionLegend compact hiddenCount={6} />
      <Table caption="Final declarations by Commission, FY 2025/2026">
        <TableHeader>
          <TableRow>
            <TableHead>Commission</TableHead>
            <TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Filed</TableHead>
            <TableHead className="text-right">Filing rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.commission}>
              <TableCell className="font-medium">{row.commission}</TableCell>
              {row.notReported ? (
                <TableCell colSpan={3}>
                  <SuppressionMarker kind="not-reported" />
                </TableCell>
              ) : (
                [row.expected, row.filed, row.rate].map((value, index) => (
                  <TableCell key={index} className="text-right tabular-nums">
                    {value == null ? (
                      <SuppressionMarker
                        kind={row.complementary ? 'complementary' : 'under-threshold'}
                      />
                    ) : (
                      value.toLocaleString('en-KE')
                    )}
                  </TableCell>
                ))
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};
