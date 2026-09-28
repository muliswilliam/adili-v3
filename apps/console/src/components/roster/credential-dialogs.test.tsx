// @vitest-environment jsdom
import { Dialog } from '@adili/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RevokeDialogContent, RotateDialogContent, SavedDialogContent } from './credential-dialogs';

describe('RotateDialogContent', () => {
  it('warns that the current secret stops working and confirms on Rotate secret', () => {
    const onConfirm = vi.fn();
    render(
      <Dialog open>
        <RotateDialogContent busy={false} error={null} onConfirm={onConfirm} />
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Rotate secret?' });
    expect(dialog.textContent).toContain('The current secret stops working immediately.');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows the failure and a busy, disabled action while rotating', () => {
    render(
      <Dialog open>
        <RotateDialogContent
          busy
          error="The secret was not rotated. Try again."
          onConfirm={vi.fn()}
        />
      </Dialog>,
    );

    expect(screen.getByRole('alert').textContent).toBe('The secret was not rotated. Try again.');
    expect(screen.getByRole('button', { name: 'Rotating…' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
  });
});

describe('RevokeDialogContent', () => {
  it('says the HR system loses access and past imports stay', () => {
    const onConfirm = vi.fn();
    render(
      <Dialog open>
        <RevokeDialogContent busy={false} error={null} onConfirm={onConfirm} />
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Revoke API access?' });
    expect(dialog.textContent).toContain(
      'Your HR system will no longer be able to update the roster.',
    );
    expect(dialog.textContent).toContain('Past imports stay in the history.');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('SavedDialogContent', () => {
  it('asks whether the secret was saved, with Go back to keep it on screen', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <SavedDialogContent onConfirm={onConfirm} />
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Have you saved the secret?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, I saved it' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
