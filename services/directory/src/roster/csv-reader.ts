import { pipeline, Readable } from 'node:stream';

import { CsvError, parse } from 'csv-parse';

import { RosterFileError, type SheetRow } from './sheet.js';

/** Longest header line looked at for delimiter detection. */
const SNIFF_LIMIT = 64 * 1024;

/**
 * Streams the records of a UTF-8 CSV file (BOM stripped, quoted fields, CRLF or LF). The
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

  async function* replay(): AsyncGenerator<Buffer> {
    yield prefix;
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) return;
      yield Buffer.from(next.value);
    }
  }

  const parser = parse({
    bom: true,
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
