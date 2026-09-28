import { posix } from 'node:path';
import type { Readable } from 'node:stream';

import { SaxesParser, type SaxesTagPlain } from 'saxes';
import ssf from 'ssf';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

import { RosterFileError, type SheetCell, type SheetRow } from './sheet.js';

/** Largest uncompressed workbook part held in memory (shared strings, styles); guards zip bombs. */
const MAX_PART_BYTES = 256 * 1024 * 1024;

/** Built-in number formats (ECMA-376 18.8.30) that are dates. */
const BUILT_IN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

interface NumberFormat {
  /** Format code, or the built-in format id for ssf's table. */
  code: string | number;
  isDate: boolean;
}

const GENERAL: NumberFormat = { code: 0, isDate: false };

/**
 * Streams the rows of the first worksheet of an XLSX workbook held in memory. Rows are read from
 * the sheet XML as it inflates, so only the shared strings and the styles are held besides the
 * file itself. Numeric cells are rendered with their number format, so a file number `123`
 * formatted `000000` reads `000123`; date cells also carry the ISO date.
 */
export async function* readXlsxRows(file: Buffer): AsyncGenerator<SheetRow> {
  const zip = await openZip(file);
  try {
    const entries = new Map<string, Entry>();
    for await (const entry of zip.eachEntry()) entries.set(entry.fileName, entry);

    const part = (path: string): Entry => {
      const entry = entries.get(path);
      if (entry === undefined) throw malformed(`${path} is missing`);
      if (entry.uncompressedSize > MAX_PART_BYTES) {
        throw new RosterFileError('too-large', 'The Excel file expands beyond the size limit');
      }
      return entry;
    };
    const open = (path: string): Promise<Readable> => zip.openReadStreamPromise(part(path));

    const workbook = await readWorkbook(await open('xl/workbook.xml'));
    const relations = entries.has('xl/_rels/workbook.xml.rels')
      ? await readRelations(await open('xl/_rels/workbook.xml.rels'))
      : [];
    const target = (type: string): string | undefined => {
      const relation = relations.find((candidate) => candidate.type.endsWith(`/${type}`));
      return relation && resolvePartPath(relation.target);
    };
    const firstSheet = relations.find((relation) => relation.id === workbook.firstSheetRelationId);
    const sheetPath = firstSheet ? resolvePartPath(firstSheet.target) : 'xl/worksheets/sheet1.xml';
    const stylesPath = target('styles') ?? 'xl/styles.xml';
    const sharedStringsPath = target('sharedStrings') ?? 'xl/sharedStrings.xml';

    const formats = entries.has(stylesPath) ? await readStyles(await open(stylesPath)) : [];
    const sharedStrings = entries.has(sharedStringsPath)
      ? await readSharedStrings(await open(sharedStringsPath))
      : [];

    yield* readSheet(await open(sheetPath), {
      sharedStrings,
      formats,
      date1904: workbook.date1904,
    });
  } finally {
    zip.close();
  }
}

function openZip(file: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error) reject(malformed(error.message));
      else resolve(zip);
    });
  });
}

function malformed(detail: string): RosterFileError {
  return new RosterFileError('malformed', `The Excel file could not be read: ${detail}`);
}

/** Targets are relative to `xl/` unless absolute within the package. */
function resolvePartPath(target: string): string {
  return target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join('xl', target));
}

function localName(name: string): string {
  return name.slice(name.indexOf(':') + 1);
}

/**
 * Feeds an XML part through a SAX parser set up with handlers, yielding after each chunk so the
 * caller can take what the handlers collected before more is inflated.
 */
async function* parseXml(
  stream: Readable,
  setup: (parser: SaxesParser) => void,
): AsyncGenerator<void> {
  const parser = new SaxesParser();
  setup(parser);
  const decoder = new TextDecoder('utf-8');
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      parser.write(decoder.decode(chunk, { stream: true }));
      yield;
    }
    parser.write(decoder.decode());
    parser.close();
    yield;
  } catch (error) {
    if (error instanceof RosterFileError) throw error;
    throw malformed(error instanceof Error ? error.message : String(error));
  } finally {
    stream.destroy();
  }
}

async function drain(events: AsyncGenerator<void>): Promise<void> {
  while ((await events.next()).done !== true);
}

async function readWorkbook(
  stream: Readable,
): Promise<{ firstSheetRelationId: string | undefined; date1904: boolean }> {
  let firstSheetRelationId: string | undefined;
  let date1904 = false;
  await drain(
    parseXml(stream, (parser) => {
      parser.on('opentag', (tag: SaxesTagPlain) => {
        const name = localName(tag.name);
        if (name === 'workbookPr') {
          const value = tag.attributes.date1904;
          date1904 = value === '1' || value === 'true';
        } else if (name === 'sheet' && firstSheetRelationId === undefined) {
          const idAttribute = Object.keys(tag.attributes).find(
            (key) => key.includes(':') && localName(key) === 'id',
          );
          firstSheetRelationId = idAttribute ? tag.attributes[idAttribute] : undefined;
        }
      });
    }),
  );
  return { firstSheetRelationId, date1904 };
}

async function readRelations(
  stream: Readable,
): Promise<{ id: string; type: string; target: string }[]> {
  const relations: { id: string; type: string; target: string }[] = [];
  await drain(
    parseXml(stream, (parser) => {
      parser.on('opentag', (tag: SaxesTagPlain) => {
        if (localName(tag.name) !== 'Relationship') return;
        const { Id: id, Type: type, Target: target } = tag.attributes;
        if (id && type && target) relations.push({ id, type, target });
      });
    }),
  );
  return relations;
}

/** Number format of each cell style (`s` attribute of a cell indexes this list). */
async function readStyles(stream: Readable): Promise<NumberFormat[]> {
  const customCodes = new Map<number, string>();
  const styleFormatIds: number[] = [];
  let inCellXfs = false;
  await drain(
    parseXml(stream, (parser) => {
      parser.on('opentag', (tag: SaxesTagPlain) => {
        const name = localName(tag.name);
        if (name === 'numFmt') {
          const id = Number(tag.attributes.numFmtId);
          const code = tag.attributes.formatCode;
          if (Number.isInteger(id) && code !== undefined) customCodes.set(id, code);
        } else if (name === 'cellXfs') {
          inCellXfs = !tag.isSelfClosing;
        } else if (name === 'xf' && inCellXfs) {
          styleFormatIds.push(Number(tag.attributes.numFmtId ?? 0));
        }
      });
      parser.on('closetag', (tag: SaxesTagPlain) => {
        if (localName(tag.name) === 'cellXfs') inCellXfs = false;
      });
    }),
  );
  return styleFormatIds.map((id) => {
    const code = customCodes.get(id);
    if (code !== undefined) return { code, isDate: ssf.is_date(code) };
    return { code: id, isDate: BUILT_IN_DATE_FORMATS.has(id) };
  });
}

/** Plain text of each shared string (rich-text runs joined, phonetic hints dropped). */
async function readSharedStrings(stream: Readable): Promise<string[]> {
  const strings: string[] = [];
  let current = '';
  let inText = false;
  let inPhonetic = false;
  await drain(
    parseXml(stream, (parser) => {
      parser.on('opentag', (tag: SaxesTagPlain) => {
        const name = localName(tag.name);
        if (name === 'si') current = '';
        else if (name === 'rPh') inPhonetic = true;
        else if (name === 't' && !inPhonetic) inText = !tag.isSelfClosing;
      });
      const onText = (text: string): void => {
        if (inText) current += text;
      };
      parser.on('text', onText);
      parser.on('cdata', onText);
      parser.on('closetag', (tag: SaxesTagPlain) => {
        const name = localName(tag.name);
        if (name === 't') inText = false;
        else if (name === 'rPh') inPhonetic = false;
        else if (name === 'si') strings.push(current);
      });
    }),
  );
  return strings;
}

interface SheetContext {
  sharedStrings: string[];
  formats: NumberFormat[];
  date1904: boolean;
}

async function* readSheet(stream: Readable, context: SheetContext): AsyncGenerator<SheetRow> {
  const ready: SheetRow[] = [];
  let row: SheetRow | null = null;
  let lastRowNumber = 0;
  let cell: { column: number; type: string; style: number; value: string } | null = null;
  let lastColumn = -1;
  let capture: 'value' | 'inline' | null = null;

  const events = parseXml(stream, (parser) => {
    parser.on('opentag', (tag: SaxesTagPlain) => {
      const name = localName(tag.name);
      if (name === 'row') {
        const number = Number(tag.attributes.r);
        lastRowNumber = Number.isInteger(number) && number > 0 ? number : lastRowNumber + 1;
        row = { rowNumber: lastRowNumber, cells: [] };
        lastColumn = -1;
        if (tag.isSelfClosing) {
          ready.push(row);
          row = null;
        }
      } else if (name === 'c' && row) {
        const reference = tag.attributes.r;
        const column = reference ? columnIndex(reference) : lastColumn + 1;
        lastColumn = column;
        cell = {
          column,
          type: tag.attributes.t ?? 'n',
          style: Number(tag.attributes.s ?? 0),
          value: '',
        };
      } else if (cell && name === 'v') {
        capture = 'value';
      } else if (cell && name === 't' && cell.type === 'inlineStr') {
        capture = 'inline';
      }
    });
    const onText = (text: string): void => {
      if (cell && capture) cell.value += text;
    };
    parser.on('text', onText);
    parser.on('cdata', onText);
    parser.on('closetag', (tag: SaxesTagPlain) => {
      const name = localName(tag.name);
      if (name === 'v' || name === 't') {
        capture = null;
      } else if (name === 'c' && cell && row) {
        const current: SheetRow = row;
        while (current.cells.length < cell.column) current.cells.push({ text: '' });
        current.cells[cell.column] = renderCell(cell, context);
        cell = null;
      } else if (name === 'row' && row) {
        ready.push(row);
        row = null;
      }
    });
  });

  while ((await events.next()).done !== true) {
    yield* ready;
    ready.length = 0;
  }
}

/** `B12` → 1 (zero-based column of an A1 reference). */
function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

function renderCell(
  cell: { type: string; style: number; value: string },
  context: SheetContext,
): SheetCell {
  switch (cell.type) {
    case 's':
      return { text: context.sharedStrings[Number(cell.value)] ?? '' };
    case 'inlineStr':
    case 'str':
    case 'e':
      return { text: cell.value };
    case 'b':
      return { text: cell.value === '1' ? 'TRUE' : 'FALSE' };
    case 'd':
      return { text: cell.value, isoDate: cell.value.slice(0, 10) };
    default: {
      if (cell.value === '') return { text: '' };
      const value = Number(cell.value);
      if (!Number.isFinite(value)) return { text: cell.value };
      const format = context.formats[cell.style] ?? GENERAL;
      const text = formatNumber(format.code, value, context.date1904);
      return format.isDate ? { text, isoDate: serialToIsoDate(value, context.date1904) } : { text };
    }
  }
}

function formatNumber(code: string | number, value: number, date1904: boolean): string {
  try {
    return ssf.format(code, value, { date1904 });
  } catch {
    return String(value);
  }
}

/** Excel date serial to `YYYY-MM-DD`; the time of day is dropped. */
function serialToIsoDate(serial: number, date1904: boolean): string {
  const days = Math.floor(serial);
  // 1900 system: day 1 is 1900-01-01, and Excel counts a 29 February 1900 that never was.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 60 ? 31 : 30);
  return new Date(epoch + days * 86_400_000).toISOString().slice(0, 10);
}
