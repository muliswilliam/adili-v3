import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDigest } from '../lib/sha256';
import { HashDropZone, type HashDropZoneProps } from './hash-drop-zone';

// A small but real PDF, standing in for an issued acknowledgement slip.
const slip = new Uint8Array(
  await readFile(path.join(import.meta.dirname, 'fixtures/acknowledgement-slip.pdf')),
);
// The documents service hashes the stored PDF with Node's crypto, as here.
const serverSha256 = createHash('sha256').update(slip).digest('hex');

function pdf(bytes: Uint8Array<ArrayBuffer>, name = 'acknowledgement-slip.pdf') {
  return new File([bytes], name, { type: 'application/pdf' });
}

function renderZone(props: Partial<HashDropZoneProps> = {}) {
  const onChecked = vi.fn();
  render(<HashDropZone expectedSha256={serverSha256} onChecked={onChecked} {...props} />);
  return { onChecked };
}

function zone() {
  return screen.getByRole('button', { name: 'Drop the PDF you were given' });
}

async function choose(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not rendered');
  await userEvent.upload(input, file, { applyAccept: false });
}

// Every way a page can reach the network, so a test fails if the file (or anything) is sent.
const network = {
  fetch: vi.fn(),
  sendBeacon: vi.fn(),
  xhrOpen: vi.fn(),
  webSocket: vi.fn(),
};

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

describe('HashDropZone', () => {
  it('invites a PDF and says it stays on the device', () => {
    renderZone();

    expect(zone().getAttribute('aria-describedby')).toContain(
      screen.getByText('The file is checked on your device and never uploaded.').id,
    );
    expect(document.querySelector('input[type="file"]')?.getAttribute('accept')).toBe(
      '.pdf,application/pdf',
    );
  });

  it('S15: the browser hash of the issued PDF equals the server SHA-256, without a request', async () => {
    const { onChecked } = renderZone();

    await choose(pdf(slip));

    expect(await screen.findByText('Identical to the issued document')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'Identical to the issued document. Not a single byte has changed.',
    );
    expect(onChecked).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'identical', sha256: serverSha256 }),
    );
  });

  it('S15: a single changed byte does not match', async () => {
    const edited = slip.slice();
    const at = edited.length - 20;
    edited[at] = (edited[at] ?? 0) ^ 1;
    const { onChecked } = renderZone();

    await choose(pdf(edited, 'acknowledgement-slip (edited).pdf'));

    expect(await screen.findByText('Does not match the issued document')).toBeTruthy();
    expect(screen.getByText('acknowledgement-slip (edited).pdf')).toBeTruthy();
    expect(onChecked).toHaveBeenCalledWith(expect.objectContaining({ status: 'mismatch' }));
  });

  it('accepts the expected digest in upper case', async () => {
    renderZone({ expectedSha256: serverSha256.toUpperCase() });

    await choose(pdf(slip));

    expect(await screen.findByText('Identical to the issued document')).toBeTruthy();
  });

  it('shows both digests on request, grouped by eight', async () => {
    const user = userEvent.setup();
    renderZone();
    await choose(pdf(slip));
    const toggle = await screen.findByRole('button', { name: 'Show technical details' });
    const grouped = formatDigest(serverSha256);
    const [fileDigest] = screen.getAllByText(grouped);

    expect(fileDigest?.closest('[hidden]')).not.toBeNull();

    await user.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide technical details');
    expect(screen.getAllByText(grouped)).toHaveLength(2);
    expect(fileDigest?.closest('[hidden]')).toBeNull();
    expect(screen.getByText('Calculated in this browser. Nothing was sent.')).toBeTruthy();
  });

  it('could not read a file that is not a PDF', async () => {
    const { onChecked } = renderZone();

    await choose(pdf(new TextEncoder().encode('PK\u0003\u0004 payslip'), 'payslip.pdf'));

    expect(await screen.findByText('Could not read this file')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show technical details' })).toBeNull();
    expect(onChecked).toHaveBeenCalledWith(expect.objectContaining({ status: 'unreadable' }));
  });

  it('could not read a file of another type dropped on the zone', async () => {
    const { onChecked } = renderZone();

    fireEvent.drop(zone(), {
      dataTransfer: { files: [new File(['x'], 'payslip.docx', { type: 'application/msword' })] },
    });

    expect(await screen.findByText('Could not read this file')).toBeTruthy();
    expect(screen.getByText('payslip.docx')).toBeTruthy();
    expect(onChecked).toHaveBeenCalledWith(expect.objectContaining({ status: 'unreadable' }));
  });

  it('could not read a file the browser fails to read', async () => {
    renderZone();
    const broken = pdf(slip);
    vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new DOMException('gone', 'NotReadableError'));

    await choose(broken);

    expect(await screen.findByText('Could not read this file')).toBeTruthy();
  });

  it('says when the browser cannot hash on this page (no secure context)', async () => {
    vi.stubGlobal('crypto', {});
    const { onChecked } = renderZone();

    await choose(pdf(slip));

    expect(await screen.findByText('This browser cannot check files on this page')).toBeTruthy();
    expect(onChecked).toHaveBeenCalledWith(expect.objectContaining({ status: 'unavailable' }));
  });

  it('shows the file while checking and moves focus to it', async () => {
    let finish: (digest: ArrayBuffer) => void = () => undefined;
    vi.spyOn(crypto.subtle, 'digest').mockReturnValue(
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
    );
    renderZone();

    await choose(pdf(slip));

    expect(await screen.findByText('Checking the file on your device')).toBeTruthy();
    expect(screen.getByText('acknowledgement-slip.pdf').closest('[tabindex="-1"]')).toBe(
      document.activeElement,
    );
    expect(screen.getByRole('status').textContent).toBe('');

    finish(new ArrayBuffer(32));

    expect(await screen.findByText('Does not match the issued document')).toBeTruthy();
  });

  it('checks another file from the zone again, with focus on it', async () => {
    const user = userEvent.setup();
    const { onChecked } = renderZone();
    await choose(pdf(slip));

    await user.click(await screen.findByRole('button', { name: 'Check another file' }));

    expect(document.activeElement).toBe(zone());
    expect(screen.getByRole('status').textContent).toBe('');

    await choose(pdf(slip.slice(0, -1)));

    expect(await screen.findByText('Does not match the issued document')).toBeTruthy();
    expect(onChecked).toHaveBeenCalledTimes(2);
  });

  it('takes other wording', () => {
    renderZone({ messages: { label: 'Weka PDF uliyopewa' } });

    expect(screen.getByRole('button', { name: 'Weka PDF uliyopewa' })).toBeTruthy();
  });
});
