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

  it('lays tiles side by side, the icon in a tile and the legend kept for screen readers', async () => {
    const user = userEvent.setup();
    render(
      <RadioGroup legend="How will you identify yourself?" legendHidden columns={2}>
        <RadioCard
          layout="tile"
          name="kind"
          value="national-id"
          label="Kenyan national ID"
          description="Checked with the national register"
          icon={<svg data-testid="id-icon" />}
        />
        <RadioCard layout="tile" name="kind" value="passport" label="Passport" />
      </RadioGroup>,
    );

    const group = screen.getByRole('radiogroup', { name: 'How will you identify yourself?' });
    expect(group.querySelector('legend')?.className).toContain('sr-only');
    expect(group.querySelector('.grid-cols-2')).not.toBeNull();
    // The icon is the tile at the top, hidden from assistive technology; no radio dot.
    const tile = screen.getByTestId('id-icon').parentElement;
    expect(tile?.getAttribute('aria-hidden')).toBe('true');
    expect(tile?.previousElementSibling?.tagName).toBe('INPUT');
    await user.click(screen.getByText('Checked with the national register'));
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Kenyan national ID' }).checked,
    ).toBe(true);
  });

  it('puts three tiles side by side from sm', () => {
    render(
      <RadioGroup legend="Your position" columns={3}>
        <RadioCard layout="tile" name="stance" value="object" label="Object" />
        <RadioCard layout="tile" name="stance" value="consent" label="Consent" />
        <RadioCard layout="tile" name="stance" value="context" label="Add context" />
      </RadioGroup>,
    );

    const group = screen.getByRole('radiogroup', { name: 'Your position' });
    expect(group.querySelector('.sm\\:grid-cols-3')).not.toBeNull();
    expect(group.querySelector('.grid-cols-2')).toBeNull();
  });
});
