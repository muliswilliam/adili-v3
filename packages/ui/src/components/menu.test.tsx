import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu, MenuContent, MenuItem, MenuTrigger } from './menu';

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

describe('Menu', () => {
  it('opens from its trigger and runs the picked item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DownloadMenu onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'Download template' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Excel template (.xlsx)' }));

    expect(onSelect).toHaveBeenCalledWith('xlsx');
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
    expect(onSelect).toHaveBeenCalledWith('csv');
  });
});
