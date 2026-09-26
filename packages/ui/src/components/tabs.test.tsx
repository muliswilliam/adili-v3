import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

function RosterTabs() {
  return (
    <Tabs defaultValue="records">
      <TabsList aria-label="Roster sections">
        <TabsTrigger value="records">Records</TabsTrigger>
        <TabsTrigger value="imports">Imports</TabsTrigger>
      </TabsList>
      <TabsContent value="records">All records</TabsContent>
      <TabsContent value="imports">Import history</TabsContent>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('links each tab to its panel', () => {
    render(<RosterTabs />);

    expect(screen.getByRole('tablist', { name: 'Roster sections' })).toBeDefined();
    const records = screen.getByRole('tab', { name: 'Records' });
    expect(records.getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel', { name: 'Records' });
    expect(panel.textContent).toBe('All records');
    expect(records.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('switches panels when a tab is chosen', () => {
    render(<RosterTabs />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Imports' }));

    expect(screen.getByRole('tab', { name: 'Imports' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Import history');
  });
});
