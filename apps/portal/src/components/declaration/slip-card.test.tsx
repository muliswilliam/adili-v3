// @vitest-environment jsdom
import { DCI, format } from '@adili/numbering/references';
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Acknowledgement, DeclarationVersion } from '../../server/declarations/types';
import { getMyAcknowledgement, reissueMyAcknowledgement } from '../../server/submission';
import { downloadFrom } from '../download';
import { SlipCard, type SlipCardProps } from './slip-card';
import { sampleDeclaration } from './testing';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());
vi.mock('../../server/submission', async () => (await import('./testing-mocks')).submissionMock());
vi.mock('../download', async () => (await import('./testing-mocks')).downloadMock());

const read = vi.mocked(getMyAcknowledgement);
const reissue = vi.mocked(reissueMyAcknowledgement);
const download = vi.mocked(downloadFrom);

const NOW = Date.parse('2026-09-30T07:42:30Z');
const REFERENCE = format(DCI, { issuer: 'PSC', period: 2026, sequence: 1 });
const CODE = 'ADL-7K3M-Q9TX-4HWD-2PBN-8RFE-V6ZC-J5';

const declaration = sampleDeclaration({
  type: 'initial',
  statementDate: '2026-09-10',
  status: 'submitted',
  commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
});

const pending: Acknowledgement = {
  status: 'pending',
  documentId: null,
  verificationId: null,
  issuedAt: null,
  verifiedCount: 0,
  downloadUrl: null,
};
const issued: Acknowledgement = {
  status: 'issued',
  documentId: '9d7c1a52-0f3e-4b8a-9c6d-2e1f0a3b4c5d',
  verificationId: CODE,
  issuedAt: '2026-09-30T07:42:04Z',
  verifiedCount: 0,
  downloadUrl: null,
};
const failed: Acknowledgement = { ...pending, status: 'failed' };

function versionWith(acknowledgement: Acknowledgement, late = false): DeclarationVersion {
  return {
    version: 1,
    reference: REFERENCE,
    submittedAt: '2026-09-30T07:42:00Z',
    late,
    canonicalSha256: 'a'.repeat(64),
    supersededAt: null,
    acknowledgement,
  };
}

const declarant = {
  fullName: 'Jane Wanjiku Mwangi',
  maskedEmail: 'm***@tsc.go.ke',
  maskedPhone: '07** *** 789',
};
const context: SlipCardProps['context'] = { verifyBaseUrl: 'http://localhost:3030', declarant };

function renderSlip(acknowledgement: Acknowledgement, overrides: Partial<SlipCardProps> = {}) {
  return render(
    <ToastProvider>
      <SlipCard
        declaration={declaration}
        version={versionWith(acknowledgement)}
        context={context}
        {...overrides}
      />
    </ToastProvider>,
  );
}

const answer = (acknowledgement: Acknowledgement) => ({ status: 'ok' as const, acknowledgement });

/**
 * Lets `ms` go by and any answered read settle, a second at most per step so each read's render
 * schedules the next one.
 */
async function wait(ms: number) {
  let left = ms;
  do {
    const step = Math.min(left, 1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
    left -= step;
  } while (left > 0);
}

/** The card's text, not the live region's copy of it. */
function onCard(text: string) {
  const found = screen.queryAllByText(text).filter((element) => !element.closest('[aria-live]'));
  if (found.length !== 1) throw new Error(`${String(found.length)} "${text}" on the card`);
  return found[0];
}

/** "Sent to …" with its masked contacts, or null. */
function sentLine() {
  return screen.queryByText(/^Sent to/)?.closest('span') ?? null;
}

function liveRegion() {
  const region = document.querySelector('[role="status"][aria-live="polite"]');
  if (!(region instanceof HTMLElement)) throw new Error('No live region');
  return region;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  read.mockReset().mockResolvedValue(answer(pending));
  reissue.mockReset();
  download.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a slip being prepared (S19)', () => {
  it('says so, and the live region stays quiet on load', () => {
    renderSlip(pending);

    expect(screen.getByText('Preparing your acknowledgement slip…')).toBeTruthy();
    expect(screen.getByText('Usually a few seconds. We also email it to you.')).toBeTruthy();
    expect(liveRegion().textContent).toBe('');
  });

  it('reads the acknowledgement every two seconds', async () => {
    renderSlip(pending);

    await wait(1999);
    expect(read).not.toHaveBeenCalled();
    await wait(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ data: { declarationId: declaration.id, version: 1 } });
    await wait(2000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(liveRegion().textContent).toBe('');
  });

  it('stops after a minute and says it is taking longer, then checks again on request', async () => {
    renderSlip(pending);

    await wait(58_000);
    expect(screen.getByText('Preparing your acknowledgement slip…')).toBeTruthy();
    await wait(2000);

    expect(read).toHaveBeenCalledTimes(30);
    expect(screen.getByText('Still preparing your slip')).toBeTruthy();
    const message = 'It is taking longer than usual. We will email you when it is ready.';
    expect(within(liveRegion()).getByText(message)).toBeTruthy();
    await wait(10_000);
    expect(read).toHaveBeenCalledTimes(30);

    read.mockResolvedValue(answer(issued));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCard('Preparing your acknowledgement slip…')).toBeTruthy();
    await wait(2000);

    expect(read).toHaveBeenCalledTimes(31);
    expect(screen.getByRole('heading', { name: 'Acknowledgement slip' })).toBeTruthy();
  });

  it('keeps polling through a read that failed', async () => {
    read.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ status: 'unavailable' });
    renderSlip(pending);

    await wait(6000);

    expect(read).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Preparing your acknowledgement slip…')).toBeTruthy();
  });

  it('shows the slip once issued and announces it once', async () => {
    read.mockResolvedValueOnce(answer(pending)).mockResolvedValue(answer(issued));
    renderSlip(pending);

    await wait(4000);

    expect(screen.getByRole('heading', { name: 'Acknowledgement slip' })).toBeTruthy();
    expect(liveRegion().textContent).toBe('Your acknowledgement slip is ready.');
    await wait(10_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('an issued slip', () => {
  it("shows the slip's details, verification code and QR", () => {
    renderSlip(issued);

    const slip = screen.getByRole('region', { name: 'Acknowledgement slip' });
    expect(within(slip).getByText('Digitally signed')).toBeTruthy();
    const details = Object.fromEntries(
      within(slip)
        .getAllByRole('term')
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(details).toEqual({
      Reference: REFERENCE,
      Declarant: 'Jane Wanjiku Mwangi',
      Commission: 'Public Service Commission',
      Type: 'Initial declaration',
      'Statement date': '10 Sep 2026',
      Version: '1',
      Submitted: '30 Sep 2026, 10:42',
    });
    expect(within(slip).getByText('Verification code')).toBeTruthy();
    const code = within(slip).getByText(CODE);
    expect(code.className).toContain('font-mono');
    expect(within(slip).getByRole('button', { name: 'Copy verification code' })).toBeTruthy();
    expect(
      within(slip).getByRole('img', { name: `QR code for verification code ${CODE}` }),
    ).toBeTruthy();
    expect(within(slip).getByText('Scan to check it is genuine')).toBeTruthy();
    expect(sentLine()?.textContent).toBe(
      'Sent to m***@tsc.go.ke (partially hidden for privacy) and 07** *** 789 (partially hidden for privacy)',
    );
    expect(within(slip).getByText('Verified 0 times')).toBeTruthy();
    expect(within(slip).getByRole('link', { name: 'Verify online' }).getAttribute('href')).toBe(
      `http://localhost:3030/v/${CODE}`,
    );
  });

  it('marks a late filing and counts one check in the singular', () => {
    render(
      <ToastProvider>
        <SlipCard
          declaration={declaration}
          version={versionWith({ ...issued, verifiedCount: 1 }, true)}
          context={context}
        />
      </ToastProvider>,
    );

    expect(screen.getByText('30 Sep 2026, 10:42 · late')).toBeTruthy();
    expect(screen.getByText('Verified 1 time')).toBeTruthy();
  });

  it('leaves out the declarant and contacts when the directory did not answer', () => {
    renderSlip(issued, { context: { ...context, declarant: null } });

    expect(screen.queryByText('Declarant')).toBeNull();
    expect(sentLine()).toBeNull();
    expect(screen.getByText('Verified 0 times')).toBeTruthy();
  });

  it('names only the contacts the declarant has', () => {
    renderSlip(issued, {
      context: { ...context, declarant: { ...declarant, maskedPhone: null } },
    });

    expect(sentLine()?.textContent).toBe('Sent to m***@tsc.go.ke (partially hidden for privacy)');
  });

  it('downloads from a link fetched on click, with a fresh verified count', async () => {
    const url = 'https://s3.test/issued/slip.pdf?signature=fresh';
    read.mockResolvedValue(answer({ ...issued, verifiedCount: 2, downloadUrl: url }));
    renderSlip(issued);
    expect(read).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Download slip' }));
    await wait(0);

    expect(read).toHaveBeenCalledWith({ data: { declarationId: declaration.id, version: 1 } });
    expect(download).toHaveBeenCalledWith(url);
    expect(screen.getByText('Verified 2 times')).toBeTruthy();
  });

  it('says so when the link could not be fetched', async () => {
    read.mockResolvedValue({ status: 'unavailable' });
    renderSlip(issued);

    fireEvent.click(screen.getByRole('button', { name: 'Download slip' }));
    await wait(0);

    expect(download).not.toHaveBeenCalled();
    expect(screen.getByText('We could not download your slip. Try again.')).toBeTruthy();
  });
});

describe('a slip that could not be prepared (S19)', () => {
  it('says so and asks for it again, then prepares it', async () => {
    reissue.mockResolvedValue({ status: 'requested' });
    renderSlip(failed);

    expect(screen.getByText('The slip could not be prepared.')).toBeTruthy();
    expect(
      screen.getByText('Your declaration is submitted and your reference is valid.'),
    ).toBeTruthy();
    expect(liveRegion().textContent).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Request again' }));
    await wait(0);

    expect(reissue).toHaveBeenCalledWith({ data: { declarationId: declaration.id, version: 1 } });
    expect(onCard('Preparing your acknowledgement slip…')).toBeTruthy();
    expect(liveRegion().textContent).toBe('Preparing your acknowledgement slip…');
  });

  it('holds "Request again" back for a minute when it fails again', async () => {
    reissue.mockResolvedValue({ status: 'requested' });
    read.mockResolvedValue(answer(failed));
    renderSlip(failed);

    fireEvent.click(screen.getByRole('button', { name: 'Request again' }));
    await wait(0);
    await wait(2000);

    expect(onCard('The slip could not be prepared.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Request again in 58s' });
    expect(button).toHaveProperty('disabled', true);
    await wait(1000);
    expect(screen.getByRole('button', { name: 'Request again in 57s' })).toBeTruthy();
    // The countdown is not in the live region: it would be read out every second.
    expect(liveRegion().textContent).toBe('The slip could not be prepared.');
    await wait(57_000);
    expect(screen.getByRole('button', { name: 'Request again' })).toHaveProperty('disabled', false);
  });

  it('waits as long as the service says when asked too soon', async () => {
    reissue.mockResolvedValue({ status: 'cooldown', retryAfterSeconds: 30 });
    renderSlip(failed);

    fireEvent.click(screen.getByRole('button', { name: 'Request again' }));
    await wait(0);

    expect(screen.getByRole('button', { name: 'Request again in 30s' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('says so when the request did not go through', async () => {
    reissue.mockResolvedValue({ status: 'unavailable' });
    renderSlip(failed);

    fireEvent.click(screen.getByRole('button', { name: 'Request again' }));
    await wait(0);

    expect(
      screen.getAllByText('We could not ask for it again. Try again in a moment.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Request again' })).toHaveProperty('disabled', false);
  });
});
