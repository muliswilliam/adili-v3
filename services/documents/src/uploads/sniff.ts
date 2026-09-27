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

/** Zip entries every Office Open XML workbook has. */
const XLSX_ENTRIES = ['[Content_Types].xml', 'xl/workbook.xml'];

/**
 * The type of an object from its bytes, not its name or declared type: `text/csv` for UTF-8
 * text without control characters, the XLSX type for a zip whose central directory holds a
 * workbook, otherwise null. Reads the first 8 KB, and for zips the tail and central directory.
 */
export async function detectType(read: RangeReader, size: number): Promise<DetectedType | null> {
  if (size <= 0) return null;
  const head = await read(0, Math.min(size, HEAD_BYTES) - 1);
  if (startsWith(head, ZIP_LOCAL_HEADER)) {
    const names = await zipEntryNames(read, size);
    return names && XLSX_ENTRIES.every((entry) => names.has(entry)) ? XLSX : null;
  }
  return looksLikeCsv(head, size > head.length) ? CSV : null;
}

function looksLikeCsv(head: Uint8Array, truncated: boolean): boolean {
  const text = startsWith(head, UTF8_BOM) ? head.subarray(UTF8_BOM.length) : head;
  // Tab, line feed and carriage return are the only control characters a CSV contains.
  if (text.some((byte) => (byte < 0x20 && ![0x09, 0x0a, 0x0d].includes(byte)) || byte === 0x7f)) {
    return false;
  }
  try {
    // A sample cut mid-character is fine: streaming mode leaves an incomplete tail undecoded.
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(text, { stream: truncated });
    return decoded.trim().length > 0;
  } catch {
    return false;
  }
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
