import { type ComponentProps, useMemo } from 'react';
import { encode } from 'uqr';

import { cn } from '../lib/cn';

/** Light modules the reader needs around the code (ISO/IEC 18004 asks for four). */
const QUIET_ZONE = 4;

export type QrCodeProps = Omit<ComponentProps<'svg'>, 'children' | 'role' | 'viewBox'> & {
  /** What the code encodes, e.g. the verify URL `https://verify.…/v/ADL-7Q4K-M2XR-9HTC`. */
  value: string;
  /**
   * The image's alt text. Name what scanning it gives, with the code the page also prints as
   * text, e.g. "QR code for verification code ADL-7Q4K-M2XR-9HTC".
   */
  label: string;
  /**
   * Width and height in CSS pixels, quiet zone included. It is rounded to the nearest whole
   * number of pixels per module, so every module is the same size and its edges are crisp.
   */
  size?: number;
};

/**
 * The dark modules of `value`'s QR code as one SVG path, one `h` run per row stretch, in a grid
 * whose origin is the quiet zone's corner. Error correction M (15%), which survives a crease
 * or a smudge on a printout.
 */
export function qrCodePath(value: string): { path: string; modules: number } {
  const { data, size } = encode(value, { ecc: 'M', border: QUIET_ZONE });
  let path = '';
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x += 1;
      path += `M${String(start)} ${String(y)}h${String(x - start)}v1h-${String(x - start)}z`;
    }
  });
  return { path, modules: size };
}

/** `size` rounded to a whole number of pixels per module (at least one). */
export function qrCodeWidth(size: number, modules: number): number {
  return modules * Math.max(1, Math.round(size / modules));
}

/**
 * A QR code drawn as an SVG from a string, with its quiet zone on white so it scans on any
 * background, dark theme included. It is an image named by `label`; print the code it carries
 * as text next to it too, for anyone who cannot scan.
 */
export function QrCode({ value, label, size = 112, className, ...props }: QrCodeProps) {
  const { path, modules } = useMemo(() => qrCodePath(value), [value]);
  const width = qrCodeWidth(size, modules);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(modules)} ${String(modules)}`}
      width={width}
      height={width}
      shapeRendering="crispEdges"
      className={cn('shrink-0 rounded-md', className)}
      {...props}
    >
      <rect width={modules} height={modules} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
