import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Synthetic documents for tests, built in memory. No real person appears here. */

/** A 2x2 PNG: something to draw on a page that has no text layer (a scan). */
export const TINY_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** The start of a JPEG file: enough for content sniffing, which is all a test needs. */
export const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

/** A page: lines of text (a text layer), or a scan (an image, no text). */
export type TestPage = { lines: string[] } | { scan: true };

/** A PDF with these pages, drawn with a standard font. */
export async function testPdf(pages: TestPage[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(TINY_PNG);
  for (const content of pages) {
    const page = pdf.addPage([595, 842]);
    if ('scan' in content) {
      page.drawImage(image, { x: 40, y: 40, width: 515, height: 762 });
      continue;
    }
    content.lines.forEach((line, index) => {
      page.drawText(line, { x: 50, y: 790 - index * 18, size: 11, font });
    });
  }
  return pdf.save();
}

/** How many pages a PDF has. */
export async function pageCount(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf)).getPageCount();
}
