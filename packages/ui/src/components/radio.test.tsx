import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { RadioCard, RadioGroup } from './radio';

function Choices({ error }: { error?: string }) {
  return (
    <RadioGroup legend="Type" hint="How it uses the platform" error={error}>
      <RadioCard name="type" value="hosted" label="Hosted" description="Staff use this console." />
      <RadioCard name="type" value="federated" label="Federated" />
    </RadioGroup>
  );
}

describe('RadioGroup', () => {
  it('is a labelled radiogroup of native radios described by their descriptions', () => {
    render(<Choices />);

    const group = screen.getByRole('radiogroup', { name: 'Type' });
    expect(group.getAttribute('aria-describedby')).toBe(
      screen.getByText('How it uses the platform').id,
    );
    const hosted = screen.getByRole<HTMLInputElement>('radio', { name: 'Hosted' });
    expect(hosted.tagName).toBe('INPUT');
    expect(hosted.getAttribute('aria-describedby')).toBe(
      screen.getByText('Staff use this console.').id,
    );
  });

  it('selects a choice from anywhere on its card and moves with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Choices />);

    await user.click(screen.getByText('Staff use this console.'));
    const hosted = screen.getByRole<HTMLInputElement>('radio', { name: 'Hosted' });
    expect(hosted.checked).toBe(true);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Federated' }).checked).toBe(true);
  });

  it('announces an error and marks the group invalid', () => {
    render(<Choices error="Choose one." />);

    const group = screen.getByRole('radiogroup', { name: 'Type' });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Choose one.');
    expect(group.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
  });
});
