import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { Attachment } from './port.js';

/**
 * A PDF as page images, for a provider that takes images but not PDFs (an Anthropic-compatible
 * gateway that drops `document` blocks). Pages render white-backed, in order, as JPEG.
 */

/**
 * The longest side of a page image. Anthropic scales anything larger down to about this before
 * the model sees it, so more pixels only cost upload time; an A4 page comes out near 135 dpi,
 * enough to read a scanned title deed or logbook.
 */
export const PAGE_IMAGE_LONG_EDGE = 1568;
/**
 * Pages a PDF may have to go as images: the most a document reading sends (MAX_DOCUMENT_PAGES),
 * well under Anthropic's per-request image limit. A longer PDF is refused rather than cut short.
 */
export const MAX_PAGE_IMAGES = 20;
/** Anthropic's limit for one inline image. */
const MAX_PAGE_IMAGE_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITY = 85;

const require = createRequire(import.meta.url);
/** Fonts for any text the scanned pages still carry (a stamp, a page number). */
const STANDARD_FONTS = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/');

export class PdfPagesError extends Error {
  override readonly name = 'PdfPagesError';
}

/** `pdf` (base64) as one JPEG attachment per page, in page order. */
export async function pdfToPageImages(pdf: Attachment): Promise<Attachment[]> {
  // pdf.js takes ownership of the buffer it is given.
  const task = getDocument({
    data: new Uint8Array(Buffer.from(pdf.data, 'base64')),
    standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGE_IMAGES) {
      throw new PdfPagesError(`The PDF has more than ${MAX_PAGE_IMAGES} pages to send as images`);
    }
    const images: Attachment[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const scale = PAGE_IMAGE_LONG_EDGE / Math.max(natural.width, natural.height);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // pdf.js draws on any 2D canvas; its types name the DOM's.
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
        .promise;
      const jpeg = canvas.toBuffer('image/jpeg', JPEG_QUALITY);
      if (jpeg.byteLength > MAX_PAGE_IMAGE_BYTES) {
        throw new PdfPagesError(`Page ${number} is over ${MAX_PAGE_IMAGE_BYTES} bytes as an image`);
      }
      images.push({ kind: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') });
    }
    return images;
  } finally {
    await task.destroy();
  }
}
