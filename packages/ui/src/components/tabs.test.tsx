import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsLink, TabsList, TabsNav, TabsTrigger } from './tabs';

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

  it('keeps a visible focus outline on tabs and panels', () => {
    render(<RosterTabs />);

    // outline-none sets the outline style to none, which also hides the focus-visible outline.
    for (const element of [
      screen.getByRole('tab', { name: 'Records' }),
      screen.getByRole('tabpanel'),
    ]) {
      expect(element.className).not.toContain('outline-none');
      expect(element.className).toContain('outline-hidden');
      expect(element.className).toContain('focus-visible:outline-solid');
    }
  });
});

describe('TabsNav', () => {
  it('is a named row of links, the current page marked', () => {
    render(
      <TabsNav aria-label="Request types">
        <TabsLink href="/all" current>
          All
        </TabsLink>
        <TabsLink asChild>
          <a href="/lea">Law enforcement</a>
        </TabsLink>
      </TabsNav>,
    );

    const nav = screen.getByRole('navigation', { name: 'Request types' });
    expect(nav.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBe('page');
    const lea = screen.getByRole('link', { name: 'Law enforcement' });
    expect(lea.getAttribute('aria-current')).toBeNull();
    expect(lea.className).toContain('border-b-2');
  });
});
