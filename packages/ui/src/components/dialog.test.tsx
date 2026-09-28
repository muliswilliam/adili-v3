import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
          <DialogHeader>
            <DialogTitle>Replace reporting officer</DialogTitle>
            <DialogDescription>The current officer loses access.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input aria-label="Email" />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </DialogFooter>
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

/**
 * Radix starts listening for outside pointer events a tick after the dialog opens, and for a
 * primary-button press waits for the click before dismissing.
 */
async function clickOutside() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.pointerDown(document.body);
  fireEvent.click(document.body);
}

describe('Dialog', () => {
  it('opens as a modal named by its title and moves focus to the first field', () => {
    render(<ReplaceDialog />);
    open();

    screen.getByRole('dialog', { name: 'Replace reporting officer' });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }));
  });

  it('skips hidden inputs and hidden sections when choosing the first field', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Edit address</DialogTitle>
          <DialogBody>
            <input type="hidden" name="id" value="1" />
            <div hidden>
              <input aria-label="Hidden by attribute" />
            </div>
            <div style={{ display: 'none' }}>
              <input aria-label="Hidden by display" />
            </div>
            <div style={{ visibility: 'hidden' }}>
              <input aria-label="Hidden by visibility" />
            </div>
            <div inert>
              <input aria-label="Inert" />
            </div>
            <input aria-label="Street" />
          </DialogBody>
        </DialogContent>
      </Dialog>,
    );

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Street' }));
  });

  it('focuses the first footer button when the dialog has no fields', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Remove officer</DialogTitle>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('renders the header, body and footer inside the dialog', () => {
    render(<ReplaceDialog />);
    open();

    const dialog = screen.getByRole('dialog');
    const title = screen.getByRole('heading', { name: 'Replace reporting officer' });
    const email = screen.getByRole('textbox', { name: 'Email' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByText('The current officer loses access.').id,
    );
    expect(dialog.contains(title) && dialog.contains(email) && dialog.contains(cancel)).toBe(true);
    // Header, body and footer are separate regions, in reading order.
    expect(title.parentElement).not.toBe(email.parentElement);
    expect(email.parentElement).not.toBe(cancel.parentElement);
    expect(title.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(email.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts the close button before the content in focus order', () => {
    render(<ReplaceDialog />);
    open();

    const close = screen.getByRole('button', { name: 'Close' });
    const email = screen.getByRole('textbox', { name: 'Email' });
    expect(close.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('traps focus inside while open', () => {
    render(<ReplaceDialog />);
    open();

    const dialog = screen.getByRole('dialog');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

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

  it('closes on an outside click', async () => {
    render(<ReplaceDialog />);
    open();

    await clickOutside();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores Esc and disables the close button while busy', () => {
    render(<ReplaceDialog busy />);
    open();

    pressEscape();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true);
  });

  it('ignores outside clicks while busy', async () => {
    render(<ReplaceDialog busy />);
    open();

    await clickOutside();

    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('disables every DialogClose while busy', () => {
    render(<ReplaceDialog busy />);
    open();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.hasAttribute('disabled')).toBe(true);
    fireEvent.click(cancel);
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('closes from a DialogClose when not busy', () => {
    render(<ReplaceDialog />);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
