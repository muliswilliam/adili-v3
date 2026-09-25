import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog';

function ReplaceDialog({ busy = false }: { busy?: boolean }) {
  return (
    <>
      <Button>Outside</Button>
      <Dialog>
        <DialogTrigger asChild>
          <Button>Replace officer</Button>
        </DialogTrigger>
        <DialogContent busy={busy}>
          <DialogTitle>Replace reporting officer</DialogTitle>
          <DialogDescription>The current officer loses access.</DialogDescription>
          <input aria-label="Email" />
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}

function open() {
  const trigger = screen.getByRole('button', { name: 'Replace officer' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
}

describe('Dialog', () => {
  it('opens as a modal named by its title and moves focus inside', () => {
    render(<ReplaceDialog />);
    open();

    const dialog = screen.getByRole('dialog', { name: 'Replace reporting officer' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('traps focus inside while open', () => {
    render(<ReplaceDialog />);
    open();

    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }));

    act(() => {
      screen.getByRole('button', { name: 'Outside', hidden: true }).focus();
    });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Esc and returns focus to its trigger', async () => {
    render(<ReplaceDialog />);
    const trigger = open();

    pressEscape();

    expect(screen.queryByRole('dialog')).toBeNull();
    // Radix restores focus on the next tick, after the content unmounts.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('ignores Esc and disables the close button while busy', () => {
    render(<ReplaceDialog busy />);
    open();

    pressEscape();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true);
  });
});
