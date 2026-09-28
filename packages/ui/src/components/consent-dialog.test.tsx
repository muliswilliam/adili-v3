import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ConsentDialog,
  type ConsentDialogProps,
  maskNationalId,
} from './consent-dialog';

function Harness(props: Partial<ConsentDialogProps>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Check registries
      </button>
      <ConsentDialog
        open={open}
        onOpenChange={setOpen}
        name="Mary Wanjiru Kennedy"
        maskedId={maskNationalId('23456789')}
        onContinue={() => {
          setOpen(false);
        }}
        {...props}
      />
    </>
  );
}

function openDialog() {
  const trigger = screen.getByRole('button', { name: 'Check registries' });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole('dialog', { name: 'Check registries' });
}

function continueButton() {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' });
}

describe('maskNationalId', () => {
  it('hides all but the last three digits', () => {
    expect(maskNationalId('23456789')).toBe('•••••789');
    expect(maskNationalId(' 12 ')).toBe('12');
  });
});

describe('ConsentDialog', () => {
  it('is a modal naming the person and their masked ID', () => {
    render(<Harness />);
    const dialog = openDialog();

    // Modal: the page behind is hidden from assistive technology while it is open.
    expect(screen.queryByRole('button', { name: 'Check registries' })).toBeNull();
    const body = screen.getByText(/what they hold about/);
    expect(dialog.getAttribute('aria-describedby')).toBe(body.id);
    expect(body.textContent).toBe(
      'Adili will ask KRA, NTSA, BRS and ArdhiSasa what they hold about Mary Wanjiru Kennedy (•••••789) and show the results to you only. Nothing is added unless you accept it.',
    );
  });

  it('names only the registries asked, e.g. to retry one', () => {
    render(<Harness registries={['ArdhiSasa']} />);
    openDialog();

    expect(screen.getByText(/what they hold about/).textContent).toBe(
      'Adili will ask ArdhiSasa what they hold about Mary Wanjiru Kennedy (•••••789) and show the results to you only. Nothing is added unless you accept it.',
    );
  });

  it('leaves the ID out when it is not known', () => {
    render(<Harness maskedId={undefined} name="you" />);
    openDialog();

    expect(screen.getByText(/what they hold about you and show/)).toBeDefined();
  });

  it('keeps Continue disabled until the request is ticked', () => {
    const onContinue = vi.fn();
    render(<Harness onContinue={onContinue} />);
    openDialog();

    expect(continueButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I request this check' }));
    expect(continueButton().disabled).toBe(false);
    fireEvent.click(continueButton());

    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('moves focus in, returns it on close and clears the tick each time it opens', async () => {
    render(<Harness />);
    openDialog();

    const checkbox = screen.getByRole<HTMLInputElement>('checkbox');
    expect(document.activeElement).toBe(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Radix restores focus on the next tick, after the content unmounts.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Check registries' }));
    });

    openDialog();
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
    expect(continueButton().disabled).toBe(true);
  });

  it('cannot be changed or closed while busy', () => {
    render(<ConsentDialog open onOpenChange={vi.fn()} name="you" onContinue={vi.fn()} busy />);

    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);
    expect(continueButton().disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
  });

  it('takes other copy', () => {
    render(
      <ConsentDialog
        open
        onOpenChange={vi.fn()}
        name="Mary"
        onContinue={vi.fn()}
        messages={{
          title: 'Angalia sajili',
          body: (name) => `Tutauliza kuhusu ${name}.`,
          confirm: 'Naomba ukaguzi huu',
          cancel: 'Ghairi',
          continue: 'Endelea',
        }}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Angalia sajili' })).toBeDefined();
    expect(screen.getByText('Tutauliza kuhusu Mary.')).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Naomba ukaguzi huu' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ghairi' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Endelea' })).toBeDefined();
  });
});
