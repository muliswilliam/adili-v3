import { render, screen } from '@testing-library/react';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { QrCode } from './qr-code';

const VERIFY_URL = 'https://verify.adili.go.ke/v/ADL-7Q4K-M2XR-9HTC';
const SCALE = 4;

/** Paints the SVG's path onto a bitmap, as a camera would see it, and reads it with jsQR. */
function scan(svg: SVGSVGElement): string | undefined {
  const modules = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
  const d = svg.querySelector('path')?.getAttribute('d') ?? '';
  const dark = new Set<string>();
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(run); i += 1) dark.add(`${String(Number(x) + i)},${String(y)}`);
  }
  const width = modules * SCALE;
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let py = 0; py < width; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const module = `${String(Math.floor(px / SCALE))},${String(Math.floor(py / SCALE))}`;
      const value = dark.has(module) ? 0 : 255;
      pixels.set([value, value, value, 255], (py * width + px) * 4);
    }
  }
  return jsQR(pixels, width, width)?.data;
}

describe('QrCode', () => {
  it('is an image named by its alt text', () => {
    render(<QrCode value={VERIFY_URL} label="QR code for verification code ADL-7Q4K-M2XR-9HTC" />);

    const image = screen.getByRole('img', {
      name: 'QR code for verification code ADL-7Q4K-M2XR-9HTC',
    });
    expect(image.getAttribute('width')).toBe('112');
  });

  it('encodes the string so a reader scans it back', () => {
    render(<QrCode value={VERIFY_URL} label="QR code" size={160} />);

    const svg = screen.getByRole<SVGSVGElement & HTMLElement>('img');
    expect(scan(svg)).toBe(VERIFY_URL);
    expect(svg.getAttribute('width')).toBe('160');
  });

  it('keeps a white quiet zone around the code', () => {
    render(<QrCode value="ADL-7Q4K-M2XR-9HTC" label="QR code" />);

    const path = screen.getByRole('img').querySelector('path')?.getAttribute('d') ?? '';
    const starts = [...path.matchAll(/M(\d+) (\d+)/g)];
    expect(Math.min(...starts.map(([, x]) => Number(x)))).toBe(4);
    expect(Math.min(...starts.map(([, , y]) => Number(y)))).toBe(4);
    expect(screen.getByRole('img').querySelector('rect')?.getAttribute('fill')).toBe('#fff');
  });

  it('redraws when the value changes', () => {
    const { rerender } = render(<QrCode value="ADL-AAAA-BBBB" label="QR code" />);
    const before = screen.getByRole('img').querySelector('path')?.getAttribute('d');

    rerender(<QrCode value="ADL-CCCC-DDDD" label="QR code" />);

    expect(screen.getByRole('img').querySelector('path')?.getAttribute('d')).not.toBe(before);
    expect(scan(screen.getByRole<SVGSVGElement & HTMLElement>('img'))).toBe('ADL-CCCC-DDDD');
  });
});
