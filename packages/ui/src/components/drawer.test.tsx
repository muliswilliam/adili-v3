import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer';

function ObligationDrawer({ wide = false }: { wide?: boolean }) {
  return (
    <>
      <Button>Outside</Button>
      <Drawer>
        <DrawerTrigger asChild>
          <Button>Open obligation</Button>
        </DrawerTrigger>
        <DrawerContent size={wide ? 'wide' : 'default'}>
          <DrawerHeader>
            <DrawerTitle>Amina Njeri Odhiambo</DrawerTitle>
            <DrawerDescription>Biennial declaration 2027</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <a href="#roster">Roster record</a>
          </DrawerBody>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button>Done</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}

/** A drawer opened from a table row link, with no DrawerTrigger. */
function RowDrawer() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        href="#o-1"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        Amina Njeri Odhiambo
      </a>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent aria-describedby={undefined}>
          <DrawerHeader>
            <DrawerTitle>Amina Njeri Odhiambo</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>Reminder history</DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function open() {
  const trigger = screen.getByRole('button', { name: 'Open obligation' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
}

function pressTab(shift = false) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift });
}

describe('Drawer', () => {
  it('opens as a modal side panel named and described by its header', () => {
    render(<ObligationDrawer />);
    open();

    const drawer = screen.getByRole('dialog', { name: 'Amina Njeri Odhiambo' });
    expect(drawer.getAttribute('aria-describedby')).toBe(
      screen.getByText('Biennial declaration 2027').id,
    );
    expect(drawer.className).toContain('right-0');
    expect(drawer.className).toContain('max-w-[520px]');
  });

  it('has a wide size for tables', () => {
    render(<ObligationDrawer wide />);
    open();

    expect(screen.getByRole('dialog').className).toContain('max-w-[720px]');
  });

  it('moves focus to its close button, the first control, on open', () => {
    render(<ObligationDrawer />);
    open();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('traps Tab inside the drawer', () => {
    render(<ObligationDrawer />);
    open();

    const close = screen.getByRole('button', { name: 'Close' });
    const done = screen.getByRole('button', { name: 'Done' });
    // Radix wraps focus from the last tabbable to the first, and back.
    done.focus();
    pressTab();
    expect(document.activeElement).toBe(close);
    pressTab(true);
    expect(document.activeElement).toBe(done);
    // Everything outside is hidden from assistive technology while open.
    expect(screen.queryByRole('button', { name: 'Outside' })).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<ObligationDrawer />);
    const trigger = open();

    pressEscape();

    expect(screen.queryByRole('dialog')).toBeNull();
    // Radix restores focus on the next tick, after the content unmounts.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('closes from the close button and from a DrawerClose in the footer', () => {
    render(<ObligationDrawer />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    open();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a click outside', async () => {
    render(<ObligationDrawer />);
    open();

    // Radix listens for outside pointer events a tick after opening.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns focus to the element that opened it when there is no trigger, such as a row link', async () => {
    render(<RowDrawer />);
    const link = screen.getByRole('link', { name: 'Amina Njeri Odhiambo' });
    link.focus();
    fireEvent.click(link);
    screen.getByRole('dialog', { name: 'Amina Njeri Odhiambo' });

    pressEscape();

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(link);
    });
  });
});
