import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SplitPane, type SplitPaneProps } from './split-pane';

function renderPane(props: Partial<SplitPaneProps> = {}) {
  render(
    <SplitPane
      main={<p>Declaration</p>}
      side={<p>Flags</p>}
      mainLabel="Declaration as filed"
      sideLabel="Review tools"
      handleLabel="Resize review panel"
      {...props}
    />,
  );
  return screen.getByRole('separator', { name: 'Resize review panel' });
}

describe('SplitPane', () => {
  it('names both panes and ties the handle to the side pane', () => {
    const handle = renderPane();

    expect(screen.getByRole('region', { name: 'Declaration as filed' }).textContent).toBe(
      'Declaration',
    );
    const side = screen.getByRole('complementary', { name: 'Review tools' });
    expect(handle.getAttribute('aria-controls')).toBe(side.id);
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute('aria-valuemin')).toBe('340');
    expect(handle.getAttribute('aria-valuemax')).toBe('720');
    expect(handle.getAttribute('aria-valuenow')).toBe('440');
  });

  it('resizes with the arrow keys, Home and End, within the limits', () => {
    const onSideWidthChange = vi.fn();
    const handle = renderPane({ defaultSideWidth: 460, onSideWidthChange });

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuenow')).toBe('484');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('436');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle.getAttribute('aria-valuenow')).toBe('720');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuenow')).toBe('720');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle.getAttribute('aria-valuenow')).toBe('340');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('340');

    expect(onSideWidthChange.mock.calls.map(([width]) => width as number)).toEqual([
      484, 460, 436, 720, 340,
    ]);
  });

  it('ignores other keys', () => {
    const handle = renderPane();

    const event = fireEvent.keyDown(handle, { key: 'ArrowUp' });

    expect(event).toBe(true);
    expect(handle.getAttribute('aria-valuenow')).toBe('440');
  });

  it('leaves arrow keys with a modifier to the browser (Alt+Left goes back)', () => {
    const handle = renderPane();

    for (const modifier of ['altKey', 'metaKey', 'ctrlKey'] as const) {
      const event = fireEvent.keyDown(handle, { key: 'ArrowLeft', [modifier]: true });
      expect(event).toBe(true);
    }
    expect(handle.getAttribute('aria-valuenow')).toBe('440');
  });

  it('reads its width out in words', () => {
    const handle = renderPane();

    expect(handle.getAttribute('aria-valuetext')).toBe('440 pixels wide');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuetext')).toBe('464 pixels wide');
  });

  it('resizes by dragging the handle', () => {
    const handle = renderPane();
    const grid = handle.parentElement ?? document.body;
    grid.getBoundingClientRect = () => ({ right: 1200 }) as DOMRect;
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 752 });
    expect(handle.hasAttribute('data-dragging')).toBe(true);
    expect(document.activeElement).toBe(handle);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 692 });
    expect(handle.getAttribute('aria-valuenow')).toBe('500');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 });
    expect(handle.getAttribute('aria-valuenow')).toBe('720');
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(handle.hasAttribute('data-dragging')).toBe(false);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 });
    expect(handle.getAttribute('aria-valuenow')).toBe('720');
  });

  it('can be controlled by the parent', () => {
    function Controlled() {
      const [width, setWidth] = useState(400);
      return (
        <>
          <output>{width}</output>
          <SplitPane
            main="Main"
            side="Side"
            mainLabel="Main"
            sideLabel="Side"
            handleLabel="Resize"
            sideWidth={width}
            onSideWidthChange={setWidth}
          />
        </>
      );
    }
    render(<Controlled />);
    const handle = screen.getByRole('separator');

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(screen.getByRole('status').textContent).toBe('424');
    expect(handle.getAttribute('aria-valuenow')).toBe('424');
  });

  it('holds a width outside the limits to them', () => {
    const handle = renderPane({ sideWidth: 900 });

    expect(handle.getAttribute('aria-valuenow')).toBe('720');
  });

  it('shows the narrow switch, and hides the other pane while stacked', () => {
    renderPane({ narrowPane: 'side', narrowSwitch: <button type="button">Declaration</button> });

    expect(screen.getByRole('button', { name: 'Declaration' }).parentElement?.className).toContain(
      '@min-[800px]:hidden',
    );
    expect(screen.getByRole('region').className).toContain('@max-[800px]:hidden');
    expect(screen.getByRole('complementary').className).not.toContain('@max-[800px]:hidden');
  });
});
