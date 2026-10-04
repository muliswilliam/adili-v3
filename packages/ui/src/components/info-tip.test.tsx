import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { InfoTip } from './info-tip';

describe('InfoTip', () => {
  it('is a button named by its label that shows its text on focus', async () => {
    render(<InfoTip label="About section 1" content="Within thirty days of appointment." />);

    await userEvent.tab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About section 1' }));
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      'Within thirty days of appointment.',
    );
  });
});
