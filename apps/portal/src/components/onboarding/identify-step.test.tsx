// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { identifyDeclarant } from '../../server/onboarding';
import { IdentifyStep } from './identify-step';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../server/onboarding', () => ({ identifyDeclarant: vi.fn() }));

const identifyMock = vi.mocked(identifyDeclarant);
const TSC = {
  slug: 'tsc',
  issuerCode: 'TSC',
  name: 'Teachers Service Commission',
  hasRoster: true,
};

function field(name: string) {
  return screen.getByRole<HTMLInputElement>('textbox', { name });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

beforeEach(() => {
  navigate.mockReset();
  identifyMock.mockReset();
});

describe('IdentifyStep', () => {
  it('moves focus to the first field to fix', () => {
    render(<IdentifyStep commission={TSC} />);

    submit();
    expect(document.activeElement).toBe(field('Personnel file number'));
    expect(field('National ID number').getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(field('Personnel file number'), { target: { value: 'TSC/100200' } });
    submit();
    expect(document.activeElement).toBe(field('National ID number'));
    expect(identifyMock).not.toHaveBeenCalled();
  });

  it('matches against the chosen Commission and moves on', async () => {
    identifyMock.mockResolvedValue({ ok: true, route: '/get-started/verify-email' });
    render(<IdentifyStep commission={TSC} />);

    fireEvent.change(field('Personnel file number'), { target: { value: 'TSC/100200' } });
    fireEvent.change(field('National ID number'), { target: { value: '1234 5678' } });
    submit();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/get-started/verify-email' });
    });
    expect(identifyMock).toHaveBeenCalledWith({
      data: { commission: 'tsc', personnelFileNumber: 'TSC/100200', nationalId: '1234 5678' },
    });
  });

  it('names the Commission when the record does not match, and focuses the message', async () => {
    identifyMock.mockResolvedValue({ ok: false, code: 'no-match' });
    render(<IdentifyStep commission={TSC} />);

    fireEvent.change(field('Personnel file number'), { target: { value: 'TSC/1' } });
    fireEvent.change(field('National ID number'), { target: { value: '99999999' } });
    submit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Teachers Service Commission's roster");
    // Focus moves in an effect after the alert renders.
    await waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
    expect(field('Personnel file number').value).toBe('TSC/1');
  });

  it('sends someone already onboarded to sign in or Keycloak reset password', async () => {
    // No links in the problem: the portal's own routes stand in.
    identifyMock.mockResolvedValue({ ok: false, code: 'already-onboarded' });
    render(<IdentifyStep commission={TSC} />);

    fireEvent.change(field('Personnel file number'), { target: { value: 'TSC/999999' } });
    fireEvent.change(field('National ID number'), { target: { value: '11111111' } });
    submit();

    expect((await screen.findByRole('alert')).textContent).toContain(
      'You already have an Adili account.',
    );
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/auth/login');
    expect(screen.getByRole('link', { name: 'Recover access' }).getAttribute('href')).toBe(
      '/auth/recover',
    );
  });
});
