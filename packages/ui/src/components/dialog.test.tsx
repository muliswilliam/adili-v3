import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

function AssignDialog({ busy = false }: { busy?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Assign reporting officer</Button>
      </DialogTrigger>
      <DialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>Assign reporting officer</DialogTitle>
          <DialogDescription>They get an activation email.</DialogDescription>
        </DialogHeader>
        <input aria-label="Email" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Send invitation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('moves focus in, traps Tab and returns focus to its trigger on close', async () => {
    const user = userEvent.setup();
    render(<AssignDialog />);
    const trigger = screen.getByRole('button', { name: 'Assign reporting officer' });

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Assign reporting officer' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab more times than there are controls: focus must stay inside.
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Esc when idle', async () => {
    const user = userEvent.setup();
    render(<AssignDialog />);
    const trigger = screen.getByRole('button', { name: 'Assign reporting officer' });

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('ignores Esc and disables its close buttons while busy', async () => {
    const user = userEvent.setup();
    render(<AssignDialog busy />);

    await user.click(screen.getByRole('button', { name: 'Assign reporting officer' }));
    await user.keyboard('{Escape}');

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Close' }).disabled).toBe(true);
  });

  it('closes on Esc again once the busy flag clears', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [busy, setBusy] = useState(true);
      return (
        <Dialog defaultOpen>
          <DialogContent busy={busy}>
            <DialogTitle>Replace reporting officer</DialogTitle>
            <DialogDescription>The current officer loses access.</DialogDescription>
            <button
              type="button"
              onClick={() => {
                setBusy(false);
              }}
            >
              Finish
            </button>
          </DialogContent>
        </Dialog>
      );
    }

    render(<Harness />);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Finish' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
