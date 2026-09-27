import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OfficerReference } from './officer-reference';
import { ToastProvider } from './toast';

describe('OfficerReference', () => {
  it('shows the reference with a button to copy it', () => {
    render(
      <ToastProvider>
        <OfficerReference value="OFR-2026-00042" />
      </ToastProvider>,
    );

    expect(screen.getByText('OFR-2026-00042')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy officer reference' })).toBeTruthy();
  });
});
