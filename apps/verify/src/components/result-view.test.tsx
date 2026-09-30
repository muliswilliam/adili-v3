// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LookupOutcome } from '../lib/lookup-outcome';
import { lookUp } from '../server/lookup.server';
import {
  MOCK_CODES,
  MOCK_SLIP_PDF,
  mockVerificationFetch,
} from '../server/verification/mock.server';
import type { paths } from '../server/verification/schema.gen';
import { ResultSkeleton, ResultView } from './result-view';

vi.mock('@tanstack/react-router', async () => (await import('../test/router-mock')).routerMock());

/** What the page gets for a code: the lookup, through the verification-api mock. */
async function outcomeFor(code: string): Promise<LookupOutcome> {
  const client = createClient<paths>({
    baseUrl: 'http://verification.test',
    fetch: mockVerificationFetch,
  });
  return lookUp(client, code);
}

async function renderResult(code: string, onRetry = vi.fn()) {
  const outcome = await outcomeFor(code);
  render(<ResultView code={code} outcome={outcome} onRetry={onRetry} />);
  return { onRetry };
}

function heading() {
  return screen.getByRole('heading', { level: 1 });
}

function detail(term: string) {
  const dt = screen.getByText(term, { selector: 'dt' });
  return dt.nextElementSibling?.textContent;
}

function link(name: string) {
  return screen.getByRole('link', { name });
}

describe('ResultView', () => {
  it('valid: says so and shows only the public fields to compare with the printed document', async () => {
    await renderResult(MOCK_CODES.valid);

    expect(heading().textContent).toBe('Valid document issued through Adili Online');
    expect(screen.getByText('This document is genuine and in force.')).toBeTruthy();
    expect(screen.getByText(MOCK_CODES.valid)).toBeTruthy();
    expect(detail('Document type')).toBe('Acknowledgement slip');
    expect(detail('Issued by')).toBe('Teachers Service Commission');
    expect(detail('Reference number')).toContain('DCI-TSC-2026-0012345-8');
    expect(detail('Version')).toBe('Version 2 · current');
    expect(detail('Issued on')).toBe('26 Sep 2026, 10:43');
    expect(screen.getByText('Compare these with the printed document.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Check your file' })).toBeTruthy();
    expect(link('Check another').getAttribute('href')).toBe('/');
  });

  it('explains the reference from the numbering registry', async () => {
    await renderResult(MOCK_CODES.valid);

    fireEvent.click(screen.getByRole('button', { name: 'What does this reference mean?' }));

    const breakdown = screen.getByRole('dialog', { name: 'How to read this reference' });
    expect(within(breakdown).getByText('Initial declaration')).toBeTruthy();
    expect(within(breakdown).getByText('Teachers Service Commission')).toBeTruthy();
  });

  it('superseded: warns, and links to the current version when the API gives it', async () => {
    await renderResult(MOCK_CODES.superseded);

    expect(heading().textContent).toBe('Superseded: a newer version of this document exists');
    expect(detail('Version')).toBe('Version 1 · superseded');
    expect(detail('Issued on')).toBe('21 Sep 2026, 16:05');
    expect(link('View the current version').getAttribute('href')).toBe(`/v/${MOCK_CODES.valid}`);
  });

  it('superseded without a link: asks for the current version instead', async () => {
    await renderResult(MOCK_CODES.supersededUnlinked);

    expect(heading().textContent).toBe('Superseded: a newer version of this document exists');
    expect(screen.queryByRole('link', { name: 'View the current version' })).toBeNull();
    expect(screen.getByText('Ask for the current version.')).toBeTruthy();
  });

  it('revoked: names the public reason category', async () => {
    await renderResult(MOCK_CODES.revoked);

    expect(heading().textContent).toBe('Revoked');
    expect(screen.getByText('Reason: Issued in error. Do not rely on this document.')).toBeTruthy();
    expect(detail('Issued by')).toBe('Public Service Commission');
    expect(detail('Version')).toBe('Version 1');
  });

  it('expired: says it is no longer valid and leaves out the fields it does not have', async () => {
    await renderResult(MOCK_CODES.expired);

    expect(heading().textContent).toBe('Expired');
    expect(screen.getByText('It was genuine, but it is no longer valid.')).toBeTruthy();
    expect(detail('Document type')).toBe('Compliance certificate');
    expect(screen.queryByText('Reference number')).toBeNull();
    expect(screen.queryByText('Version')).toBeNull();
    expect(screen.getByRole('region', { name: 'Check your file' })).toBeTruthy();
  });

  it('confidential: shows validity only, with the file check', async () => {
    await renderResult(MOCK_CODES.confidential);

    expect(heading().textContent).toBe('Valid document issued through Adili Online');
    expect(screen.getByText('Only validity is shown for this kind of document.')).toBeTruthy();
    expect(screen.queryByText('Document type')).toBeNull();
    expect(screen.queryByText('Issued by')).toBeNull();
    expect(screen.getByRole('region', { name: 'Check your file' })).toBeTruthy();
  });

  it('not found: says to treat the document as not genuine and offers to edit the code', async () => {
    await renderResult(MOCK_CODES.notFound);

    expect(heading().textContent).toBe(
      'Not found: no document with this code was issued through Adili Online.',
    );
    expect(screen.getByText('Treat the document as not genuine.')).toBeTruthy();
    expect(link('Edit code').getAttribute('href')).toBe(
      `/?code=${encodeURIComponent(MOCK_CODES.notFound)}`,
    );
    expect(screen.queryByRole('region', { name: 'Check your file' })).toBeNull();
  });

  it('malformed: says the code cannot be one', () => {
    render(<ResultView code="ADL-7Q4U-XX" outcome={{ kind: 'malformed' }} onRetry={vi.fn()} />);

    expect(heading().textContent).toBe('This is not a valid verification code');
    expect(
      screen.getByText('Codes start with ADL and never use the letters I, L, O or U.'),
    ).toBeTruthy();
    expect(screen.getByText('ADL-7Q4U-XX')).toBeTruthy();
    expect(link('Try again').getAttribute('href')).toBe('/');
  });

  it('unavailable: says it is no verdict on the document and tries again on request', async () => {
    const { onRetry } = await renderResult(MOCK_CODES.unavailable);

    expect(heading().textContent).toBe('We cannot check documents right now');
    expect(
      screen.getByText('This does not mean the document is fake. Try again in a few minutes.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  describe('rate limited', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('counts down the wait the API gave, then lets the visitor try again', async () => {
      const { onRetry } = await renderResult(MOCK_CODES.rateLimited);

      expect(heading().textContent).toBe('Too many checks from your connection');
      expect(screen.getByText('Try again in 42 seconds.')).toBeTruthy();
      expect(screen.getByText('This says nothing about the document.')).toBeTruthy();
      const retry = screen.getByRole<HTMLButtonElement>('button', { name: 'Try again' });
      expect(retry.disabled).toBe(true);

      act(() => {
        vi.advanceTimersByTime(41_000);
      });
      expect(screen.getByText('Try again in 1 second.')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(retry.disabled).toBe(false);
      fireEvent.click(retry);
      expect(onRetry).toHaveBeenCalledOnce();
    });
  });

  it('loading: a skeleton, announced as checking', () => {
    render(<ResultSkeleton />);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toBe('Checking the document');
  });
});

describe('Check your file (S15)', () => {
  // Every way a page can reach the network: the file must never leave the device.
  const network = { fetch: vi.fn(), sendBeacon: vi.fn(), xhrOpen: vi.fn(), webSocket: vi.fn() };

  beforeEach(() => {
    vi.stubGlobal('fetch', network.fetch);
    vi.stubGlobal('WebSocket', network.webSocket);
    vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(network.xhrOpen);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: network.sendBeacon,
      configurable: true,
    });
  });

  afterEach(() => {
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.sendBeacon).not.toHaveBeenCalled();
    expect(network.xhrOpen).not.toHaveBeenCalled();
    expect(network.webSocket).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'sendBeacon');
  });

  async function choose(bytes: Uint8Array<ArrayBuffer>, name: string) {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('file input not rendered');
    await userEvent.upload(input, new File([bytes], name, { type: 'application/pdf' }), {
      applyAccept: false,
    });
  }

  it('the issued PDF is identical to the hash the API returned', async () => {
    await renderResult(MOCK_CODES.valid);

    await choose(new Uint8Array(MOCK_SLIP_PDF), 'acknowledgement-slip.pdf');

    expect(await screen.findByText('Identical to the issued document')).toBeTruthy();
    expect(screen.getByText('Not a single byte has changed (version 2).')).toBeTruthy();
  });

  it('a copy with one byte changed does not match', async () => {
    await renderResult(MOCK_CODES.valid);
    const edited = new Uint8Array(MOCK_SLIP_PDF);
    edited[edited.length - 3] = (edited[edited.length - 3] ?? 0) ^ 1;

    await choose(edited, 'acknowledgement-slip (edited).pdf');

    expect(await screen.findByText('Does not match the issued document')).toBeTruthy();
  });

  it('a file that is not a PDF cannot be read', async () => {
    await renderResult(MOCK_CODES.valid);

    await choose(new TextEncoder().encode('Payslip September 2026'), 'payslip.pdf');

    expect(await screen.findByText('Could not read this file')).toBeTruthy();
  });
});
