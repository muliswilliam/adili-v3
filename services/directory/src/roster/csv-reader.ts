import { pipeline, Readable } from 'node:stream';

import { CsvError, parse } from 'csv-parse';

import { RosterFileError, type SheetRow } from './sheet.js';

/** Longest header line looked at for delimiter detection. */
const SNIFF_LIMIT = 64 * 1024;

/** Why a CSV that is not UTF-8 cannot be imported, and how to fix it. */
export const NOT_UTF8 =
  'The file is not saved as UTF-8 text, so some characters cannot be read. In Excel, choose Save As > CSV UTF-8 (Comma delimited) and upload the file again.';

/**
 * Streams the records of a UTF-8 CSV file (BOM stripped, quoted fields, CRLF or LF); a file that
 * is not UTF-8 throws `RosterFileError` (`encoding`) when the first byte that is not is read. The
 * delimiter is `;` when the first line has more semicolons than commas outside quotes, `,`
 * otherwise. Row numbers count records from 1, blank lines included, so they match the row
 * numbers a spreadsheet shows when the file has no multi-line cells.
 */
export async function* readCsvRows(source: AsyncIterable<Uint8Array>): AsyncGenerator<SheetRow> {
  const iterator = source[Symbol.asyncIterator]();
  const head: Buffer[] = [];
  let headLength = 0;
  let done = false;
  while (!done && headLength < SNIFF_LIMIT && !head.some((chunk) => chunk.includes(0x0a))) {
    const next = await iterator.next();
    if (next.done === true) done = true;
    else {
      const chunk = Buffer.from(next.value);
      head.push(chunk);
      headLength += chunk.length;
    }
  }
  const prefix = Buffer.concat(head);

  // Decoded strictly: a byte that is not UTF-8 anywhere in the file fails the file, rather than
  // importing names with U+FFFD in place of their letters. The decoder drops the BOM.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decode = (bytes: Uint8Array, stream: boolean): string => {
    try {
      return decoder.decode(bytes, { stream });
    } catch {
      throw new RosterFileError('encoding', NOT_UTF8);
    }
  };
  async function* replay(): AsyncGenerator<string> {
    let bytes: Uint8Array | undefined = prefix;
    while (bytes !== undefined) {
      const text = decode(bytes, true);
      if (text !== '') yield text;
      const next = await iterator.next();
      bytes = next.done === true ? undefined : next.value;
    }
    // Throws for a file that ends mid-character.
    const rest = decode(new Uint8Array(), false);
    if (rest !== '') yield rest;
  }

  const parser = parse({
    delimiter: detectDelimiter(prefix),
    relax_column_count: true,
    skip_empty_lines: false,
  });
  // A failing source destroys the parser with its error, surfacing it to the loop below;
  // destroying the parser (early exit) tears the source down.
  pipeline(Readable.from(replay()), parser, () => undefined);

  let rowNumber = 0;
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      rowNumber += 1;
      yield { rowNumber, cells: record.map((text) => ({ text })) };
    }
  } catch (error) {
    if (error instanceof CsvError) {
      throw new RosterFileError('malformed', `The CSV could not be read: ${error.message}`);
    }
    throw error;
  } finally {
    parser.destroy();
    await iterator.return?.();
  }
}

function detectDelimiter(prefix: Buffer): ',' | ';' {
  const firstLine = prefix.toString('utf8').split('\n', 1)[0] ?? '';
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') commas += 1;
    else if (!quoted && char === ';') semicolons += 1;
  }
  return semicolons > commas ? ';' : ',';
}
