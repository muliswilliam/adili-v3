import { CSV, type DetectedType, XLSX } from './purposes.js';

/** Reads bytes `start` to `end` inclusive of the object being sniffed. */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

/** Bytes inspected for the text heuristic. */
const HEAD_BYTES = 8 * 1024;
/** The end-of-central-directory record is 22 bytes plus a comment of at most 65,535. */
const EOCD_SEARCH_BYTES = 22 + 0xffff;
/** A workbook's central directory lists a few dozen entries; anything larger is not a roster. */
const MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const UTF8_BOM = [0xef, 0xbb, 0xbf];
/** UTF-16 little- and big-endian byte order marks. */
const UTF16_BOMS = [
  [0xff, 0xfe],
  [0xfe, 0xff],
];
/** `%PDF-`: text-like at first, but never a CSV. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** Zip entries every Office Open XML workbook has. */
const XLSX_ENTRIES = ['[Content_Types].xml', 'xl/workbook.xml'];

/**
 * Text that is not UTF-8: most likely a CSV saved in a legacy encoding (Excel's plain "CSV" is
 * Windows-1252) or as UTF-16 ("Unicode Text"). Not importable; the fix is saving as CSV UTF-8.
 */
export const NOT_UTF8_TEXT = 'not-utf8-text';

export type SniffedType = DetectedType | typeof NOT_UTF8_TEXT;

/**
 * The type of an object from its bytes, not its name or declared type: `text/csv` for UTF-8
 * text without control characters, `NOT_UTF8_TEXT` for text in another encoding, the XLSX type
 * for a zip whose central directory holds a workbook, otherwise null. Reads the first 8 KB, and
 * for zips the tail and central directory. Only the sample is checked: the importer rejects a
 * file whose text stops being UTF-8 later on.
 */
export async function detectType(read: RangeReader, size: number): Promise<SniffedType | null> {
  if (size <= 0) return null;
  const head = await read(0, Math.min(size, HEAD_BYTES) - 1);
  if (startsWith(head, ZIP_LOCAL_HEADER)) {
    const names = await zipEntryNames(read, size);
    return names && XLSX_ENTRIES.every((entry) => names.has(entry)) ? XLSX : null;
  }
  return textType(head, size > head.length);
}

function textType(head: Uint8Array, truncated: boolean): SniffedType | null {
  if (UTF16_BOMS.some((bom) => startsWith(head, bom))) return NOT_UTF8_TEXT;
  if (startsWith(head, PDF_MAGIC)) return null;
  const text = startsWith(head, UTF8_BOM) ? head.subarray(UTF8_BOM.length) : head;
  // Tab, line feed and carriage return are the only control characters a CSV contains.
  if (text.some((byte) => (byte < 0x20 && ![0x09, 0x0a, 0x0d].includes(byte)) || byte === 0x7f)) {
    return null;
  }
  let decoded;
  try {
    // A sample cut mid-character is fine: streaming mode leaves an incomplete tail undecoded.
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(text, { stream: truncated });
  } catch {
    // Printable bytes that are not UTF-8: text in a single-byte encoding.
    return NOT_UTF8_TEXT;
  }
  return decoded.trim().length > 0 ? CSV : null;
}

/** Entry names from the zip's central directory, or null when it is not a readable zip. */
async function zipEntryNames(read: RangeReader, size: number): Promise<Set<string> | null> {
  const tailStart = Math.max(0, size - EOCD_SEARCH_BYTES);
  const tail = await read(tailStart, size - 1);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return null;
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (
    directorySize === 0 ||
    directorySize > MAX_CENTRAL_DIRECTORY_BYTES ||
    directoryOffset + directorySize > tailStart + eocd
  ) {
    return null;
  }
  const directory =
    directoryOffset >= tailStart
      ? tail.subarray(directoryOffset - tailStart, directoryOffset - tailStart + directorySize)
      : await read(directoryOffset, directoryOffset + directorySize - 1);
  return centralDirectoryNames(directory);
}

function centralDirectoryNames(directory: Uint8Array): Set<string> | null {
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const decoder = new TextDecoder();
  const names = new Set<string>();
  let at = 0;
  while (at + 46 <= directory.length) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER_SIGNATURE) return null;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (at + 46 + nameLength > directory.length) return null;
    names.add(decoder.decode(directory.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}
