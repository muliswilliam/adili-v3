import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SplitPane, type SplitPaneProps } from './split-pane';

function renderPane(props: Partial<SplitPaneProps> = {}) {
  const view = render(
    <SplitPane
      main={<p>Declaration</p>}
      side={<p>Review</p>}
      label="Resize review panel"
      defaultSize={440}
      {...props}
    />,
  );
  const handle = screen.getByRole('separator', { name: 'Resize review panel' });
  const root = view.container.firstElementChild as HTMLElement;
  return { handle, root };
}

describe('SplitPane', () => {
  it('is a focusable vertical separator valued by the side pane width', () => {
    const { handle, root } = renderPane();

    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('440');
    expect(handle.getAttribute('aria-valuemin')).toBe('340');
    expect(handle.getAttribute('aria-valuemax')).toBe('720');
    expect(document.getElementById(handle.getAttribute('aria-controls') ?? '')?.textContent).toBe(
      'Review',
    );
    expect(root.style.getPropertyValue('--split-side')).toBe('440px');
  });

  it('widens the side pane with the left arrow and narrows it with the right', async () => {
    const user = userEvent.setup();
    const onSizeChange = vi.fn();
    const { handle, root } = renderPane({ onSizeChange });

    await user.tab();
    expect(document.activeElement).toBe(handle);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(handle.getAttribute('aria-valuenow')).toBe('488');
    expect(root.style.getPropertyValue('--split-side')).toBe('488px');
    await user.keyboard('{ArrowRight}');
    expect(handle.getAttribute('aria-valuenow')).toBe('464');
    expect(onSizeChange.mock.calls).toEqual([[464], [488], [464]]);
  });

  it('jumps to the limits with Home and End, and stays within them', async () => {
    const user = userEvent.setup();
    const onSizeChange = vi.fn();
    const { handle } = renderPane({ onSizeChange, step: 200 });

    handle.focus();
    await user.keyboard('{Home}');
    expect(handle.getAttribute('aria-valuenow')).toBe('720');
    await user.keyboard('{ArrowLeft}');
    expect(handle.getAttribute('aria-valuenow')).toBe('720');
    await user.keyboard('{End}');
    expect(handle.getAttribute('aria-valuenow')).toBe('340');
    await user.keyboard('{ArrowRight}');
    expect(handle.getAttribute('aria-valuenow')).toBe('340');
    // Pressing a key at a limit changes nothing, so nothing is reported.
    expect(onSizeChange.mock.calls).toEqual([[720], [340]]);
  });

  it('resizes to the pointer while dragging', () => {
    const onSizeChange = vi.fn();
    const { handle, root } = renderPane({ onSizeChange });
    root.getBoundingClientRect = () => ({ right: 1200 }) as DOMRect;
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 752 });
    expect(handle.dataset.dragging).toBe('true');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 692 });
    expect(handle.getAttribute('aria-valuenow')).toBe('500');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 });
    expect(handle.getAttribute('aria-valuenow')).toBe('720');
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(handle.dataset.dragging).toBeUndefined();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 });
    expect(handle.getAttribute('aria-valuenow')).toBe('720');
    expect(onSizeChange.mock.calls).toEqual([[500], [720]]);
  });

  it('ignores a pointer that is not the main button', () => {
    const { handle } = renderPane();

    fireEvent.pointerDown(handle, { button: 2, pointerId: 1 });

    expect(handle.dataset.dragging).toBeUndefined();
  });

  it('can be controlled', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [size, setSize] = useState(400);
      return (
        <>
          <SplitPane
            main="Main"
            side="Side"
            label="Resize"
            size={size}
            onSizeChange={setSize}
            min={200}
            max={600}
            step={50}
          />
          <output>{size}</output>
        </>
      );
    }
    render(<Controlled />);

    screen.getByRole('separator').focus();
    await user.keyboard('{ArrowLeft}');

    expect(screen.getByRole('status').textContent).toBe('450');
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('450');
  });

  it('clamps a starting width outside the limits', () => {
    const { handle } = renderPane({ defaultSize: 9000 });

    expect(handle.getAttribute('aria-valuenow')).toBe('720');
  });
});
