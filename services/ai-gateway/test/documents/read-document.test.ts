import { describe, expect, it } from 'vitest';

import { DocumentError } from '../../src/documents/document-error.js';
import { readDocument } from '../../src/documents/read-document.js';
import { JPEG_BYTES, pageCount, testPdf, TINY_PNG } from '../support/documents.js';

const TITLE_PAGE = [
  'REPUBLIC OF KENYA',
  'THE LAND REGISTRATION ACT, 2012',
  'TITLE DEED',
  'Title Number: NAKURU/NJORO/1187',
  'Approximate Area: 0.405 Ha',
];

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/**
 * Reading a document for the model (spec 05b): pages with a text layer are read from it, so it
 * can be minimised; the pages without one are what the model sees as images.
 */
describe('readDocument', () => {
  it('reads every page of a digital PDF from its text layer, with no attachment', async () => {
    const pdf = await testPdf([{ lines: TITLE_PAGE }, { lines: ['Page two of the title deed'] }]);

    const document = await readDocument(pdf, 'application/pdf');

    expect(document.pageCount).toBe(2);
    expect(document.visual).toBeNull();
    expect(document.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(document.pages[0]?.textLayer?.split('\n')).toEqual(TITLE_PAGE);
    expect(document.pages[1]?.textLayer).toBe('Page two of the title deed');
  });

  it('sends a scanned PDF as it is, with no text layer to read', async () => {
    const pdf = await testPdf([{ scan: true }, { scan: true }]);

    const document = await readDocument(pdf, 'application/pdf');

    expect(document.pages).toEqual([
      { page: 1, textLayer: null },
      { page: 2, textLayer: null },
    ]);
    expect(document.visual).toEqual({
      kind: 'pdf',
      mediaType: 'application/pdf',
      data: base64(pdf),
      pages: [1, 2],
    });
  });

  it('attaches only the scanned pages of a mixed PDF, so no text layer is sent unminimised', async () => {
    const pdf = await testPdf([{ lines: TITLE_PAGE }, { scan: true }, { lines: ['Annex'] }]);

    const document = await readDocument(pdf, 'application/pdf');

    expect(document.pages.map((page) => page.textLayer === null)).toEqual([false, true, false]);
    expect(document.visual?.pages).toEqual([2]);
    const attached = Buffer.from(document.visual?.data ?? '', 'base64');
    expect(await pageCount(attached)).toBe(1);
    const scanned = await readDocument(attached, 'application/pdf');
    expect(scanned.pages).toEqual([{ page: 1, textLayer: null }]);
  });

  it('builds the same attachment from the same PDF, so replay fixtures match', async () => {
    const pdf = await testPdf([{ lines: TITLE_PAGE }, { scan: true }]);

    const first = await readDocument(pdf, 'application/pdf');
    const second = await readDocument(pdf, 'application/pdf');

    expect(second.visual?.data).toBe(first.visual?.data);
  });

  it('reads an image as one page the model sees', async () => {
    expect(await readDocument(TINY_PNG, 'image/png')).toEqual({
      pageCount: 1,
      pages: [{ page: 1, textLayer: null }],
      visual: { kind: 'image', mediaType: 'image/png', data: base64(TINY_PNG), pages: [1] },
    });
    expect((await readDocument(JPEG_BYTES, 'image/jpeg')).visual?.mediaType).toBe('image/jpeg');
  });

  it('refuses a file that is not what its content type says', async () => {
    const pdf = await testPdf([{ lines: TITLE_PAGE }]);

    await expect(readDocument(TINY_PNG, 'application/pdf')).rejects.toThrow(DocumentError);
    await expect(readDocument(pdf, 'image/png')).rejects.toThrow(DocumentError);
    await expect(readDocument(JPEG_BYTES, 'image/png')).rejects.toMatchObject({
      kind: 'unreadable',
    });
  });

  it('refuses a damaged PDF', async () => {
    const pdf = await testPdf([{ lines: TITLE_PAGE }]);

    await expect(readDocument(pdf.slice(0, 200), 'application/pdf')).rejects.toMatchObject({
      kind: 'unreadable',
    });
  });

  it('refuses a PDF with more pages than a reading takes', async () => {
    const pdf = await testPdf(Array.from({ length: 21 }, () => ({ lines: ['A page'] })));

    await expect(readDocument(pdf, 'application/pdf')).rejects.toMatchObject({
      kind: 'too-large',
    });
  });

  it('refuses an image larger than the model takes', async () => {
    const large = new Uint8Array(5 * 1024 * 1024 + 1);
    large.set(TINY_PNG);

    await expect(readDocument(large, 'image/png')).rejects.toMatchObject({ kind: 'too-large' });
  });
});
