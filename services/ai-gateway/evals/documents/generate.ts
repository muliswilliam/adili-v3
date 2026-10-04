import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { DOCUMENTS, type Block, type SyntheticDocument } from './specs.js';

/**
 * Generates the synthetic documents of the extract-document golden set (spec 05b S10) from
 * `specs.ts`: digital PDFs drawn with standard fonts (a text layer), and scans of them (the page
 * rendered, tilted, tinted, noised and saved as JPEG, alone or inside a PDF). Every name, number
 * and institution is made up. The output is committed, since fixtures key on the exact bytes;
 * run `pnpm --filter @adili/ai-gateway eval:documents` after editing a spec, then re-record.
 */

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const STANDARD_FONTS = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/');

const PAGE: [number, number] = [595, 842];
const MARGIN = 56;
const INK = rgb(0.1, 0.1, 0.12);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
  serifBold: PDFFont;
}

/** Lines of `text` no wider than `width` at `size`. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    const next = line === '' ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(next, size) > width && line !== '') {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Draws one page's blocks top to bottom. */
function drawPage(page: PDFPage, blocks: readonly Block[], fonts: Fonts, serif: boolean): void {
  const [width, height] = PAGE;
  const regular = serif ? fonts.serif : fonts.regular;
  const bold = serif ? fonts.serifBold : fonts.bold;
  let y = height - MARGIN;
  const usable = width - 2 * MARGIN;
  for (const block of blocks) {
    switch (block.kind) {
      case 'border':
        page.drawRectangle({
          x: 28,
          y: 28,
          width: width - 56,
          height: height - 56,
          borderColor: INK,
          borderWidth: 2,
        });
        page.drawRectangle({
          x: 34,
          y: 34,
          width: width - 68,
          height: height - 68,
          borderColor: INK,
          borderWidth: 0.6,
        });
        break;
      case 'center': {
        const size = block.size ?? 12;
        const font = block.bold ? bold : regular;
        const textWidth = font.widthOfTextAtSize(block.text, size);
        y -= size + 4;
        page.drawText(block.text, { x: (width - textWidth) / 2, y, size, font, color: INK });
        break;
      }
      case 'text': {
        const size = block.size ?? 10.5;
        const font = block.bold ? bold : regular;
        for (const line of wrap(block.text, font, size, usable)) {
          y -= size + 4;
          page.drawText(line, { x: MARGIN, y, size, font, color: INK });
        }
        y -= 4;
        break;
      }
      case 'field': {
        const size = 10.5;
        y -= size + 7;
        page.drawText(block.label, { x: MARGIN, y, size, font: bold, color: INK });
        const lines = wrap(block.value, regular, size, usable - 190);
        lines.forEach((line, index) => {
          page.drawText(line, { x: MARGIN + 190, y: y - index * (size + 3), size, font: regular });
        });
        y -= (lines.length - 1) * (size + 3);
        break;
      }
      case 'amounts': {
        const size = 10;
        for (const [label, amount] of block.rows) {
          y -= size + 6;
          const strong = label.toUpperCase() === label;
          const font = strong ? bold : regular;
          page.drawText(label, { x: MARGIN + 8, y, size, font, color: INK });
          const amountWidth = font.widthOfTextAtSize(amount, size);
          page.drawText(amount, { x: width - MARGIN - 8 - amountWidth, y, size, font, color: INK });
        }
        y -= 6;
        break;
      }
      case 'rule':
        y -= 8;
        page.drawLine({
          start: { x: MARGIN, y },
          end: { x: width - MARGIN, y },
          thickness: 0.8,
          color: INK,
        });
        y -= 4;
        break;
      case 'gap':
        y -= block.size;
        break;
      case 'stamp': {
        const size = 11;
        const textWidth = bold.widthOfTextAtSize(block.text, size);
        const x = width - MARGIN - textWidth - 40;
        page.drawRectangle({
          x: x - 8,
          y: y - 40,
          width: textWidth + 16,
          height: 26,
          borderColor: rgb(0.55, 0.1, 0.12),
          borderWidth: 1.5,
        });
        page.drawText(block.text, {
          x,
          y: y - 31,
          size,
          font: bold,
          color: rgb(0.55, 0.1, 0.12),
        });
        y -= 48;
        break;
      }
    }
  }
}

/** The document as a digital PDF: every page drawn, with its text layer. */
async function digitalPdf(spec: SyntheticDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    serif: await pdf.embedFont(StandardFonts.TimesRoman),
    serifBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
  };
  for (const blocks of spec.pages) {
    drawPage(pdf.addPage(PAGE), blocks, fonts, spec.serif ?? false);
  }
  return pdf.save();
}

/** A small deterministic generator, so a regenerated scan has the same grain. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Each page of `pdf` as it would come off a scanner, or a phone held above it. */
async function scans(
  pdf: Uint8Array,
  look: NonNullable<SyntheticDocument['scan']>,
): Promise<Canvas[]> {
  const task = getDocument({
    data: new Uint8Array(pdf),
    standardFontDataUrl: STANDARD_FONTS,
    verbosity: 0,
  });
  const document = await task.promise;
  const pages: Canvas[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const viewport = page.getViewport({ scale: look.scale ?? 1.6 });
    const sheet = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const sheetContext = sheet.getContext('2d');
    sheetContext.fillStyle = '#ffffff';
    sheetContext.fillRect(0, 0, sheet.width, sheet.height);
    // pdf.js draws on any 2D canvas; its types name the DOM's.
    await page.render({
      canvas: sheet as never,
      canvasContext: sheetContext as never,
      viewport,
    }).promise;

    const scan = createCanvas(sheet.width, sheet.height);
    const context = scan.getContext('2d');
    context.fillStyle = look.background ?? '#efece3';
    context.fillRect(0, 0, scan.width, scan.height);
    context.save();
    context.translate(scan.width / 2, scan.height / 2);
    context.rotate(((look.tiltDegrees ?? 0.6) * Math.PI) / 180);
    context.scale(look.zoom ?? 0.97, look.zoom ?? 0.97);
    if (look.blur) context.filter = `blur(${look.blur}px)`;
    context.drawImage(sheet, -sheet.width / 2, -sheet.height / 2);
    context.restore();
    context.filter = 'none';
    if (look.shadow) {
      const gradient = context.createLinearGradient(0, 0, scan.width, scan.height);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(40,30,10,0.28)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, scan.width, scan.height);
    }
    const image = context.getImageData(0, 0, scan.width, scan.height);
    const next = random(number * 7919 + (look.seed ?? 1));
    const tint = [248, 244, 232];
    for (let index = 0; index < image.data.length; index += 4) {
      const grain = (next() - 0.5) * (look.noise ?? 18);
      for (let channel = 0; channel < 3; channel++) {
        const value = image.data[index + channel] ?? 255;
        // Paper is never white: multiply by its tint, then add the grain.
        const tinted = (value * (tint[channel] ?? 255)) / 255 + grain;
        image.data[index + channel] = Math.max(0, Math.min(255, Math.round(tinted)));
      }
    }
    context.putImageData(image, 0, 0);
    pages.push(scan);
  }
  await task.destroy();
  return pages;
}

const jpeg = (canvas: Canvas, quality: number) => canvas.toBuffer('image/jpeg', quality);

/** A PDF of JPEG page images, as a scanner without text recognition writes one. */
async function imagePdf(
  pages: readonly Uint8Array[],
  keep?: readonly number[],
): Promise<PDFDocument> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const [index, bytes] of pages.entries()) {
    if (keep && !keep.includes(index + 1)) continue;
    const image = await pdf.embedJpg(bytes);
    const page = pdf.addPage(PAGE);
    page.drawImage(image, { x: 0, y: 0, width: PAGE[0], height: PAGE[1] });
  }
  return pdf;
}

async function generate(spec: SyntheticDocument): Promise<Uint8Array> {
  const digital = await digitalPdf(spec);
  if (spec.output === 'pdf') return digital;
  const look = spec.scan ?? {};
  const scanned = (await scans(digital, look)).map((page) => jpeg(page, look.quality ?? 72));
  if (spec.output === 'jpeg') {
    if (scanned.length !== 1) throw new Error(`${spec.file}: a JPEG scan has one page`);
    return scanned[0] as Uint8Array;
  }
  if (spec.output === 'scanned-pdf') return (await imagePdf(scanned)).save();
  // Mixed: the digital pages as drawn, the scanned ones as images, in order.
  const mixed = await PDFDocument.create({ updateMetadata: false });
  const source = await PDFDocument.load(digital, { updateMetadata: false });
  const images = await imagePdf(scanned);
  for (let number = 1; number <= spec.pages.length; number++) {
    const from = spec.scannedPages?.includes(number) ? images : source;
    const [page] = await mixed.copyPages(from, [number - 1]);
    if (page) mixed.addPage(page);
  }
  return mixed.save();
}

await mkdir(OUT_DIR, { recursive: true });
for (const spec of DOCUMENTS) {
  const bytes = await generate(spec);
  await writeFile(join(OUT_DIR, spec.file), bytes);
  process.stdout.write(`${spec.file}: ${bytes.byteLength} bytes\n`);
}
