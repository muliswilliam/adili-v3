import { PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { PAGE_IMAGE_LONG_EDGE, pdfToPageImages } from '../../src/providers/pdf-pages.js';
import type { Attachment } from '../../src/providers/port.js';

/** A PDF whose pages differ in size, so their images show which page each came from. */
async function pdf(sizes: [number, number][]): Promise<Attachment> {
  const document = await PDFDocument.create();
  for (const [width, height] of sizes) {
    const page = document.addPage([width, height]);
    page.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  }
  const bytes = await document.save();
  return { kind: 'pdf', mediaType: 'application/pdf', data: Buffer.from(bytes).toString('base64') };
}

/** Width and height from a baseline or progressive JPEG's start-of-frame marker. */
function jpegSize(base64: string): [number, number] {
  const bytes = Buffer.from(base64, 'base64');
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1] ?? 0;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc2) {
      return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    }
    offset += 2 + length;
  }
  throw new Error('no start-of-frame marker');
}

describe('PDF pages as images', () => {
  it('renders every page as a JPEG, in order, with the long edge at the image limit', async () => {
    const images = await pdfToPageImages(
      await pdf([
        [595, 842],
        [842, 595],
        [400, 400],
      ]),
    );

    expect(images.map((image) => [image.kind, image.mediaType])).toEqual([
      ['image', 'image/jpeg'],
      ['image', 'image/jpeg'],
      ['image', 'image/jpeg'],
    ]);
    const sizes = images.map((image) => jpegSize(image.data));
    expect(sizes[0]?.[1]).toBe(PAGE_IMAGE_LONG_EDGE);
    expect(sizes[0]?.[0]).toBeLessThan(PAGE_IMAGE_LONG_EDGE);
    expect(sizes[1]?.[0]).toBe(PAGE_IMAGE_LONG_EDGE);
    expect(sizes[1]?.[1]).toBeLessThan(PAGE_IMAGE_LONG_EDGE);
    expect(sizes[2]).toEqual([PAGE_IMAGE_LONG_EDGE, PAGE_IMAGE_LONG_EDGE]);
  });

  it('refuses a PDF with more pages than a request may carry as images', async () => {
    const pages = Array.from({ length: 21 }, (): [number, number] => [200, 200]);
    await expect(pdfToPageImages(await pdf(pages))).rejects.toThrow(/more than 20 pages/);
  });
});
