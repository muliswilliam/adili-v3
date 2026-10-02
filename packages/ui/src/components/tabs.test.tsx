import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

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

    // With 8px of padding at each end, only padding left to scroll is nothing more to see.
    list.style.paddingLeft = '8px';
    list.style.paddingRight = '8px';
    scrollLeft = 193;
    fireEvent.scroll(list);
    expect(list.dataset.moreAfter).toBeUndefined();
    scrollLeft = 7;
    fireEvent.scroll(list);
    expect(list.dataset.moreBefore).toBeUndefined();
    expect(list.dataset.moreAfter).toBe('true');
  });

  it('N12: measures again when a tab is added later, and watches its size', async () => {
    const observed = new Set<Element>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(target: Element) {
          observed.add(target);
        }
        unobserve(target: Element) {
          observed.delete(target);
        }
        disconnect() {
          observed.clear();
        }
      },
    );
    function GrowingTabs() {
      const [registry, setRegistry] = useState(false);
      return (
        <>
          <Tabs defaultValue="records">
            <TabsList aria-label="Case sections">
              <TabsTrigger value="records">Records</TabsTrigger>
              <TabsTrigger value="imports">Imports</TabsTrigger>
              {registry ? <TabsTrigger value="registry">Registry</TabsTrigger> : null}
            </TabsList>
          </Tabs>
          <button
            type="button"
            onClick={() => {
              setRegistry(true);
            }}
          >
            Load registry
          </button>
        </>
      );
    }
    render(<GrowingTabs />);
    const list = screen.getByRole('tablist');
    // Each tab is 150px of a 358px-wide list: two fit, a third runs past the right edge.
    Object.defineProperty(list, 'clientWidth', { value: 358 });
    Object.defineProperty(list, 'scrollWidth', { get: () => list.children.length * 150 });
    Object.defineProperty(list, 'scrollLeft', { value: 0 });
    expect(list.dataset.moreAfter).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Load registry' }));
    // No scroll and no resize of what was observed: the added tab alone brings the fade.
    await waitFor(() => {
      expect(list.dataset.moreAfter).toBe('true');
    });
    expect(observed.has(screen.getByRole('tab', { name: 'Registry' }))).toBe(true);
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
