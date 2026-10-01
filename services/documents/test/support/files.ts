import { readFileSync } from 'node:fs';

const FIXTURES = new URL('../fixtures/', import.meta.url);

export const fixture = (name: string): Buffer => readFileSync(new URL(name, FIXTURES));

/** A 1x1 transparent PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** The start of a JPEG (JFIF): enough for the sniffer and the scanner. */
export const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

/** A minimal one-page PDF. */
export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  'latin1',
);

/** An ISO base media file that opens with an `ftyp` box of `major` and `compatible` brands. */
export function isoMedia(major: string, compatible: string[]): Buffer {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + brands.length);
  // A `meta` box header follows, as in a real HEIF.
  return Buffer.concat([
    size,
    Buffer.from(`ftyp${brands}`, 'latin1'),
    Buffer.from([0, 0, 0, 8]),
    Buffer.from('meta'),
  ]);
}

/** The start of a HEIC photo as an iPhone saves it. */
export const HEIC = isoMedia('heic', ['mif1', 'heic']);

/**
 * The EICAR anti-virus test file, a CSV-looking line every scanner reports as infected. Built
 * at runtime so the repository holds no file a developer's scanner would quarantine.
 */
export const EICAR = Buffer.from(
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''),
);
