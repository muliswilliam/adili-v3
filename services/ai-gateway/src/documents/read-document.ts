import { PDFDocument } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';

import type { Attachment } from '../providers/port.js';
import { DocumentError } from './document-error.js';

/**
 * Reading a document for the model (spec 05b, `extract-document`). A page with a text layer is
 * read from it: text the gateway minimises before any provider call, like any input. A page
 * without one (a scan, a photo) can only be seen, so it goes to the provider as an image or a PDF
 * of those pages alone, which the classification gate governs (`highly-confidential`). A digital
 * PDF therefore leaves the platform minimised; a scan leaves as it is, only where the tenant's
 * gate allows it.
 */

/** Content types the gateway reads: what the documents service accepts, less HEIC. */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

/** Pages a reading takes: a title deed, logbook, payslip or letter is a few. */
export const MAX_DOCUMENT_PAGES = 20;
/** The largest image providers take inline (Anthropic's limit). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/**
 * Characters (not counting spaces) the text of a page that shows an image must have to count as
 * its text layer; fewer is a scan with a stray line (a stamp, a page number), read from its image.
 * A searchable scan's recognised text counts: it is read from that text, minimised.
 */
const MIN_TEXT_LAYER_CHARS = 30;
/** pdf.js operators that paint an image. */
const IMAGE_OPS: ReadonlySet<number> = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
]);

export interface DocumentPage {
  /** 1-based, in the document's order. */
  page: number;
  /** The page's text, lines separated by `\n`; null for a page read from its image. */
  textLayer: string | null;
}

/** The pages read from their image, as one attachment, with their page numbers in order. */
export type VisualPages = Attachment & { pages: number[] };

export interface ReadDocument {
  pageCount: number;
  pages: DocumentPage[];
  /** Null when every page has a text layer. */
  visual: VisualPages | null;
}

/** The content type the file's first bytes say it is, of those the gateway reads. */
export function sniffContentType(bytes: Uint8Array): DocumentContentType | undefined {
  const starts = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

/** Reads `bytes`, which must be what `contentType` says; throws `DocumentError` otherwise. */
export async function readDocument(
  bytes: Uint8Array,
  contentType: DocumentContentType,
): Promise<ReadDocument> {
  const sniffed = sniffContentType(bytes);
  if (sniffed !== contentType) {
    throw new DocumentError(
      'unreadable',
      `The file is ${sniffed ?? 'not a PDF or image'}, not ${contentType}`,
    );
  }
  if (contentType !== 'application/pdf') {
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new DocumentError('too-large', `The image is over ${MAX_IMAGE_BYTES} bytes`);
    }
    return {
      pageCount: 1,
      pages: [{ page: 1, textLayer: null }],
      visual: { kind: 'image', mediaType: contentType, data: base64(bytes), pages: [1] },
    };
  }
  return readPdf(bytes);
}

/**
 * A PDF read page by page. pdf.js and pdf-lib are lenient with damaged files, but what they still
 * throw on (a page they cannot parse, an encrypted file to copy pages from) is an unreadable
 * document too, not a failure of the job's attempt.
 */
async function readPdf(bytes: Uint8Array): Promise<ReadDocument> {
  try {
    return await readPages(bytes);
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError('unreadable', 'The PDF cannot be read', { cause: error });
  }
}

/**
 * The pages read from their image go to the provider as a PDF, the whole file when every page is
 * a scan: no bigger than the fetcher's limit (`AI_DOCUMENT_MAX_BYTES`, 20 MB), which keeps it
 * under the provider's request limit once base64-encoded.
 */
async function readPages(bytes: Uint8Array): Promise<ReadDocument> {
  const pages = await textLayers(bytes);
  const scanned = pages.filter((page) => page.textLayer === null).map((page) => page.page);
  if (scanned.length === 0) return { pageCount: pages.length, pages, visual: null };
  const data = scanned.length === pages.length ? bytes : await pdfOfPages(bytes, scanned);
  return {
    pageCount: pages.length,
    pages,
    visual: { kind: 'pdf', mediaType: 'application/pdf', data: base64(data), pages: scanned },
  };
}

/**
 * Each page's text layer, or null for a page read from its image: one without text, or one that
 * shows an image and has hardly any text.
 */
async function textLayers(bytes: Uint8Array): Promise<DocumentPage[]> {
  // pdf.js takes ownership of the buffer it is given: pass a copy.
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    let document;
    try {
      document = await task.promise;
    } catch (error) {
      throw new DocumentError('unreadable', 'The PDF cannot be parsed', { cause: error });
    }
    if (document.numPages > MAX_DOCUMENT_PAGES) {
      throw new DocumentError('too-large', `The PDF has more than ${MAX_DOCUMENT_PAGES} pages`);
    }
    const pages: DocumentPage[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = linesOf(content.items.filter((item): item is TextItem => 'str' in item));
      const chars = text.replace(/\s/gu, '').length;
      const showsImage = (await page.getOperatorList()).fnArray.some((op) => IMAGE_OPS.has(op));
      const readable = chars > 0 && (!showsImage || chars >= MIN_TEXT_LAYER_CHARS);
      pages.push({ page: number, textLayer: readable ? text : null });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/**
 * A page's text items as lines: items on one baseline (within half the font size) join left to
 * right, lines run top to bottom.
 */
function linesOf(items: readonly TextItem[]): string {
  const placed = items
    .filter((item) => item.str.trim() !== '')
    .map((item) => ({
      text: item.str,
      x: item.transform[4] as number,
      y: item.transform[5] as number,
      size: Math.max(Math.abs(item.transform[3] as number), 1),
    }));
  const lines: { y: number; size: number; parts: { x: number; text: string }[] }[] = [];
  for (const item of placed) {
    const line = lines.find((each) => Math.abs(each.y - item.y) <= each.size / 2);
    if (line) line.parts.push({ x: item.x, text: item.text });
    else lines.push({ y: item.y, size: item.size, parts: [{ x: item.x, text: item.text }] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text.trim())
        .join(' '),
    )
    .join('\n');
}

/** A PDF of `pages` alone, in order. Deterministic: no dates or ids are written. */
async function pdfOfPages(bytes: Uint8Array, pages: readonly number[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const target = await PDFDocument.create({ updateMetadata: false });
  const copied = await target.copyPages(
    source,
    pages.map((page) => page - 1),
  );
  for (const page of copied) target.addPage(page);
  return target.save();
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}
