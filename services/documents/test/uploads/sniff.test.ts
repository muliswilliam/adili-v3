import { describe, expect, it } from 'vitest';

import { CSV, XLSX } from '../../src/uploads/purposes.js';
import { detectType, NOT_UTF8_TEXT, type RangeReader } from '../../src/uploads/sniff.js';
import { EICAR, fixture, PNG } from '../support/files.js';

/** Sniffs an in-memory object, recording the ranges read. */
async function sniff(bytes: Uint8Array) {
  const reads: [number, number][] = [];
  const read: RangeReader = (start, end) => {
    reads.push([start, end]);
    return Promise.resolve(bytes.subarray(start, end + 1));
  };
  return { type: await detectType(read, bytes.length), reads };
}

describe('detectType', () => {
  it('detects a CSV, reading only its first 8 KB', async () => {
    const big = Buffer.concat([fixture('roster.csv'), Buffer.alloc(20_000, 'a,b,c\n')]);
    expect(await sniff(big)).toEqual({ type: CSV, reads: [[0, 8191]] });
  });

  it('accepts a UTF-8 BOM and multi-byte characters cut at the sample boundary', async () => {
    const header = Buffer.from('﻿name,town\n');
    // The first byte of the two-byte `ũ` is the sample's last byte.
    const text = Buffer.concat([
      header,
      Buffer.alloc(8191 - header.length, 'x'),
      Buffer.from(`ũ,Nyeri\n${'Wanjirũ,Nyeri\n'.repeat(100)}`),
    ]);
    expect(text[8191]).toBe(0xc5);
    expect((await sniff(text)).type).toBe(CSV);
  });

  it('detects an XLSX from its central directory', async () => {
    expect((await sniff(fixture('roster.xlsx'))).type).toBe(XLSX);
  });

  it.each([
    ['a PNG', PNG],
    ['a zip that is not a workbook', fixture('archive.zip')],
    ['a truncated zip', fixture('roster.xlsx').subarray(0, 600)],
    ['UTF-16 text without a byte order mark', Buffer.from('name,town\n', 'utf16le')],
    ['a PDF', Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\n', 'latin1')],
    ['whitespace only', Buffer.from(' \n\r\n\t')],
    ['an empty object', Buffer.alloc(0)],
  ])('rejects %s', async (_, bytes) => {
    expect((await sniff(bytes)).type).toBeNull();
  });

  it.each([
    ['Windows-1252 text (Excel "CSV")', Buffer.from('name,town\nRen\xe9,Nairobi\n', 'latin1')],
    ['UTF-16 text (Excel "Unicode Text")', Buffer.from('﻿name\ttown\n', 'utf16le')],
    ['big-endian UTF-16 text', Buffer.from([0xfe, 0xff, 0x00, 0x6e, 0x00, 0x0a])],
  ])('tells %s from other bytes: text, but not UTF-8', async (_, bytes) => {
    expect((await sniff(bytes)).type).toBe(NOT_UTF8_TEXT);
  });

  it('treats the EICAR test file as text (the scanner, not the sniffer, catches it)', async () => {
    expect((await sniff(EICAR)).type).toBe(CSV);
  });
});
