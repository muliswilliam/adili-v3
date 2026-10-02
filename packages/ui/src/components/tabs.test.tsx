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

  it('fades out at an edge with more tabs past it, as the list scrolls', () => {
    render(<RosterTabs />);
    const list = screen.getByRole('tablist');
    expect(list.dataset.moreAfter).toBeUndefined();
    expect(list.style.maskImage).toBe('');

    // 390px wide: the tabs run on 200px past the right edge.
    let scrollLeft = 0;
    Object.defineProperty(list, 'clientWidth', { value: 358 });
    Object.defineProperty(list, 'scrollWidth', { value: 558 });
    Object.defineProperty(list, 'scrollLeft', { get: () => scrollLeft });
    fireEvent.scroll(list);
    expect(list.dataset.moreBefore).toBeUndefined();
    expect(list.dataset.moreAfter).toBe('true');
    expect(list.style.maskImage).toContain('linear-gradient(to right, #000, #000 40px');
    expect(list.style.maskImage).toContain('calc(100% - 40px), transparent)');

    scrollLeft = 100;
    fireEvent.scroll(list);
    expect(list.dataset.moreBefore).toBe('true');
    expect(list.dataset.moreAfter).toBe('true');

    scrollLeft = 200;
    fireEvent.scroll(list);
    expect(list.dataset.moreBefore).toBe('true');
    expect(list.dataset.moreAfter).toBeUndefined();
    expect(list.style.maskImage).toContain('linear-gradient(to right, transparent, #000 40px');
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
