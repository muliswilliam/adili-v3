import { Delete02Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Menu, MenuItem, MenuNote } from './menu';

const LABEL = 'Actions for logbook-KCB782M.pdf';

function renderMenu({ readDisabled = false } = {}) {
  const onRead = vi.fn();
  const onRemove = vi.fn();
  render(
    <>
      <Menu label={LABEL}>
        <MenuItem icon={SparklesIcon} tone="ai" onSelect={onRead} disabled={readDisabled}>
          Read into the form
        </MenuItem>
        <MenuNote icon={SparklesIcon}>Payslips: not enabled for your Commission</MenuNote>
        <MenuItem icon={Delete02Icon} tone="destructive" onSelect={onRemove}>
          Remove
        </MenuItem>
      </Menu>
      <button type="button">Elsewhere</button>
    </>,
  );
  const trigger = screen.getByRole('button', { name: LABEL });
  return { trigger, onRead, onRemove };
}

function entries() {
  return screen.getAllByRole('menuitem');
}

describe('Menu', () => {
  it('is a closed menu button until pressed', () => {
    const { trigger } = renderMenu();

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on click, named after its trigger, with focus on the first entry', () => {
    const { trigger } = renderMenu();

    fireEvent.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: LABEL })).toBeDefined();
    expect(entries().map((entry) => entry.textContent)).toEqual([
      'Read into the form',
      'Payslips: not enabled for your Commission',
      'Remove',
    ]);
    expect(document.activeElement).toBe(entries()[0]);
  });

  it('shows a note as an unavailable entry', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);

    expect(
      screen
        .getByRole('menuitem', { name: 'Payslips: not enabled for your Commission' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('moves between entries with the arrows, Home and End, wrapping at the ends', () => {
    const { trigger } = renderMenu();
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    const [read, note, remove] = entries();
    expect(document.activeElement).toBe(remove);

    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(read);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(note);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(remove);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(read);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(remove);
  });

  it('closes on Esc and returns focus to the trigger', () => {
    const { trigger } = renderMenu();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes, returns focus and then runs the chosen action', () => {
    const { trigger, onRemove } = renderMenu();
    fireEvent.click(trigger);
    onRemove.mockImplementation(() => {
      expect(document.activeElement).toBe(trigger);
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

    expect(onRemove).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does nothing when a disabled entry is chosen', () => {
    const { trigger, onRead } = renderMenu({ readDisabled: true });
    fireEvent.click(trigger);

    const read = screen.getByRole('menuitem', { name: 'Read into the form' });
    expect(read.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(read);

    expect(onRead).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeDefined();
  });

  it('closes on a click outside, on Tab and on a second press of the trigger', () => {
    const { trigger } = renderMenu();

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
