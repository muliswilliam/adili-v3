import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OTP_ACTIONS, OTP_FIELDS } from '../adili-otp';
import KcPage from '../KcPage';
import { type StoryName, stories } from '../stories';

function renderStory(name: StoryName) {
  render(<KcPage kcContext={stories[name]()} />);
}

function box(position: number) {
  return screen.getByRole<HTMLInputElement>('textbox', { name: `Digit ${String(position)} of 6` });
}

/** The value a submit button posts under `action`. */
function actionOf(button: HTMLElement) {
  expect(button.getAttribute('name')).toBe(OTP_FIELDS.action);
  return button.getAttribute('value');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OTP page', () => {
  it('says where the code went, masked, with a labelled group of six boxes', async () => {
    renderStory('otp');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Enter the code we sent' }),
    ).toBeTruthy();
    expect(
      screen.getByText(/We sent a 6-digit code by SMS to/).closest('p')?.textContent,
    ).toContain('07** *** 123 (partially hidden for privacy).');
    expect(screen.getByRole('group', { name: 'Enter the 6-digit code' })).toBeTruthy();
    for (let position = 1; position <= 6; position += 1) expect(box(position)).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(box(1));
    });
  });

  it('posts the code with action verify as soon as the sixth digit is in', async () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(() => undefined);
    renderStory('otp');
    await screen.findByRole('heading', { level: 1 });

    fireEvent.paste(box(1), { clipboardData: { getData: () => '482913' } });

    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    const form = submit.mock.contexts[0] as HTMLFormElement;
    const data = new FormData(form);
    expect(data.get(OTP_FIELDS.code)).toBe('482913');
    expect(data.get(OTP_FIELDS.action)).toBe(OTP_ACTIONS.verify);
    expect(screen.getByText('Checking the code')).toBeTruthy();
    expect(box(1).disabled).toBe(true);
  });

  it('holds "Resend code" until the cooldown ends', async () => {
    renderStory('otp');

    const waiting = await screen.findByRole('button', { name: /Resend in 1:00|Resend in 0:59/ });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
  });

  it('holds "Send it by email instead" for the same cooldown', async () => {
    renderStory('otp');

    const button = await screen.findByRole('button', { name: 'Send it by email instead' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('announces the resend wait politely at 10-second steps only', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      renderStory('otp');
      await screen.findByRole('button', { name: 'Resend in 1:00' });
      const live = document.querySelector('.sr-only[aria-live="polite"]');
      if (!live) throw new Error('no live region for the resend wait');
      expect(live.textContent).toBe('');

      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(live.textContent).toBe('');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(live.textContent).toBe('You can ask for a new code in 50 seconds.');

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(live.textContent).toBe('You can ask for a new code in 40 seconds.');

      act(() => {
        vi.advanceTimersByTime(40_000);
      });
      expect(live.textContent).toBe('You can ask for a new code now.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers a resend and the other channel once the cooldown is over', async () => {
    renderStory('otp-resend-ready');

    const resend = await screen.findByRole('button', { name: 'Resend code' });
    expect((resend as HTMLButtonElement).disabled).toBe(false);
    expect(actionOf(resend)).toBe(OTP_ACTIONS.resend);
    expect(actionOf(screen.getByRole('button', { name: 'Send it by email instead' }))).toBe(
      OTP_ACTIONS.sendEmail,
    );
    expect(screen.getByText('You can ask for 2 more codes.')).toBeTruthy();
  });

  it('switches back to SMS from an email code', async () => {
    renderStory('otp-email');

    expect(
      (await screen.findByText(/We sent a 6-digit code to/)).closest('p')?.textContent,
    ).toContain('j***@gmail.com');
    expect(actionOf(screen.getByRole('button', { name: 'Send it by SMS instead' }))).toBe(
      OTP_ACTIONS.sendSms,
    );
  });

  it('hides the switch when there is no other contact', async () => {
    renderStory('otp-no-email');

    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Send it by email instead' })).toBeNull();
  });

  it('says how many attempts are left after a wrong code, and focuses the alert', async () => {
    renderStory('otp-wrong');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That code is not right. 3 attempts left.');
    await waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
  });

  it('uses the singular for the last attempt', async () => {
    renderStory('otp-wrong-last');

    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code is not right. 1 attempt left.',
    );
  });

  it('explains an expired code', async () => {
    renderStory('otp-expired');

    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code has expired. Resend to get a new one.',
    );
  });

  it('warns before the resend that ends the sign-in', async () => {
    renderStory('otp-last-resend');

    expect(await screen.findByText('Asking for another code starts sign-in again.')).toBeTruthy();
  });

  it('offers email when the SMS could not be sent', async () => {
    renderStory('otp-sms-failed');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We could not send the SMS' }),
    ).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('j***@gmail.com');
    expect(actionOf(screen.getByRole('button', { name: 'Send by email' }))).toBe(
      OTP_ACTIONS.sendEmail,
    );
    expect(actionOf(screen.getByRole('button', { name: 'Try SMS again' }))).toBe(
      OTP_ACTIONS.sendSms,
    );
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
  });

  it('only retries when the SMS failed and there is no email', async () => {
    renderStory('otp-sms-failed-no-email');

    expect(actionOf(await screen.findByRole('button', { name: 'Try again' }))).toBe(
      OTP_ACTIONS.sendSms,
    );
    expect(screen.queryByRole('button', { name: 'Send by email' })).toBeNull();
  });

  it('asks to try again later when both channels failed', async () => {
    renderStory('otp-send-both-failed');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We could not send your code' }),
    ).toBeTruthy();
    expect(actionOf(screen.getByRole('button', { name: 'Try again' }))).toBe(OTP_ACTIONS.resend);
  });

  it('titles the step-up check differently', async () => {
    renderStory('otp-step-up');

    expect(await screen.findByRole('heading', { level: 1, name: "Confirm it's you" })).toBeTruthy();
  });

  it('keeps the page title when the attempted user is shown', async () => {
    renderStory('otp');

    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('OFR-0012345-B')).toBeTruthy();
  });
});
