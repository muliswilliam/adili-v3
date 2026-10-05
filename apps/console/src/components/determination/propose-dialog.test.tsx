// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProposeDialog } from './propose-dialog';

describe('ProposeDialog', () => {
  it('offers no referral for further action when the case has nothing to refer on (#610)', () => {
    render(
      <ToastProvider>
        <ProposeDialog
          open
          onOpenChange={() => undefined}
          subject="DCB-TSC-2026-0004127-E · Brian Wekesa"
          revising={{
            form: { outcome: 'further-action', reasons: 'Seen.', note: 'Watch it.' },
            returnedBy: 'Lucy Wambui',
            reason: 'Say more.',
          }}
          onSubmit={() => Promise.resolve(null)}
        />
      </ToastProvider>,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Start referral' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Start action' })).toBeTruthy();
  });
});
