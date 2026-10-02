// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IdTypeStep } from './id-type-step';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

beforeEach(() => {
  navigate.mockReset();
});

describe('IdTypeStep', () => {
  it('continues only once an ID type is chosen, to Your details for it', () => {
    render(<IdTypeStep />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' });
    expect(button.disabled).toBe(true);
    expect(
      screen.getByRole('radiogroup', { name: 'How will you identify yourself?' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Passport' }));
    fireEvent.click(button);

    expect(navigate).toHaveBeenCalledWith({
      to: '/access/get-started/details',
      search: { kind: 'passport' },
    });
  });

  it('keeps the ID type chosen before and says why the applicant starts again', () => {
    render(<IdTypeStep preselected="national-id" notice="too-many" />);

    expect(screen.getByRole('alert').textContent).toBe('Too many attempts. Start again.');
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Kenyan national ID' }).checked,
    ).toBe(true);
  });
});
