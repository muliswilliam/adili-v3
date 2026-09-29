import { Delete02Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu, MenuContent, MenuItem, MenuNote, MenuTrigger } from './menu';

function DownloadMenu({ onSelect }: { onSelect: (format: string) => void }) {
  return (
    <Menu>
      <MenuTrigger>Download template</MenuTrigger>
      <MenuContent>
        <MenuItem
          onSelect={() => {
            onSelect('csv');
          }}
        >
          CSV template (.csv)
        </MenuItem>
        <MenuItem
          onSelect={() => {
            onSelect('xlsx');
          }}
        >
          Excel template (.xlsx)
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

const LABEL = 'Actions for logbook-KCB782M.pdf';

function AttachmentMenu({
  onRead,
  onRemove,
  readDisabled = false,
}: {
  onRead: () => void;
  onRemove: () => void;
  readDisabled?: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger aria-label={LABEL}>…</MenuTrigger>
      <MenuContent>
        <MenuItem icon={SparklesIcon} tone="ai" onSelect={onRead} disabled={readDisabled}>
          Read into the form
        </MenuItem>
        <MenuNote icon={SparklesIcon}>Payslips: not enabled for your Commission</MenuNote>
        <MenuItem icon={Delete02Icon} tone="destructive" onSelect={onRemove}>
          Remove
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

describe('Menu', () => {
  it('opens from its trigger and runs the picked item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DownloadMenu onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'Download template' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Excel template (.xlsx)' }));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('xlsx');
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('works from the keyboard and closes on Escape', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DownloadMenu onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'Download template' });

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('csv');
    });
  });

  it('shows a note as an unavailable entry that leaves the menu open', async () => {
    const user = userEvent.setup();
    const onRead = vi.fn();
    const onRemove = vi.fn();
    render(<AttachmentMenu onRead={onRead} onRemove={onRemove} />);

    await user.click(screen.getByRole('button', { name: LABEL }));
    expect(screen.getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual([
      'Read into the form',
      'Payslips: not enabled for your Commission',
      'Remove',
    ]);
    const note = screen.getByRole('menuitem', {
      name: 'Payslips: not enabled for your Commission',
    });
    expect(note.getAttribute('aria-disabled')).toBe('true');

    await user.click(note);
    expect(screen.getByRole('menu')).toBeDefined();
    expect(onRead).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('closes, returns focus to the trigger and then runs the chosen action', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<AttachmentMenu onRead={vi.fn()} onRemove={onRemove} />);
    const trigger = screen.getByRole('button', { name: LABEL });
    let focusedOnRun: Element | null = null;
    onRemove.mockImplementation(() => {
      focusedOnRun = document.activeElement;
    });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));

    await waitFor(() => {
      expect(onRemove).toHaveBeenCalledOnce();
    });
    expect(focusedOnRun).toBe(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does nothing when a disabled item is chosen', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRead = vi.fn();
    render(<AttachmentMenu onRead={onRead} onRemove={vi.fn()} readDisabled />);

    await user.click(screen.getByRole('button', { name: LABEL }));
    const read = screen.getByRole('menuitem', { name: 'Read into the form' });
    expect(read.getAttribute('aria-disabled')).toBe('true');
    await user.click(read);

    expect(onRead).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeDefined();
  });
});
