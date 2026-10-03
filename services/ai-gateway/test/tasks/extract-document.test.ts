import { describe, expect, it } from 'vitest';

import { readDocument } from '../../src/documents/read-document.js';
import { preparePrompt } from '../../src/policy/prompt.js';
import type { ContentPart } from '../../src/providers/port.js';
import { extractDocument, type ExtractInput } from '../../src/tasks/extract-document.js';
import { outputSchemaOf } from '../../src/tasks/task.js';
import { testPdf, TINY_PNG } from '../support/documents.js';

const SHA256 = 'a'.repeat(64);

const input = (changes: Partial<ExtractInput> = {}): ExtractInput =>
  extractDocument.input.parse({
    kind: 'extract-document',
    documentKindHint: 'title-deed',
    target: { section: 'assets', itemType: 'land' },
    attachment: {
      downloadUrl: 'http://localhost:8333/clean/upload-1?X-Amz-Signature=secret',
      contentType: 'application/pdf',
      sha256: SHA256,
    },
    language: 'en',
    ...changes,
  });

const TITLE_DEED = [
  'REPUBLIC OF KENYA',
  'TITLE DEED',
  'Title Number: NAKURU/NJORO/1187',
  'Approximate Area: 0.405 Ha',
  'Proprietor: WANJIRU AKINYI KAMAU, ID No. 28765432',
];

const textOf = (parts: string | ContentPart[]) =>
  typeof parts === 'string'
    ? parts
    : parts.map((part) => (part.type === 'text' ? part.text : '')).join('');

describe('extract-document input', () => {
  it('takes an item type of the target section only', () => {
    const parsed = extractDocument.input.safeParse({
      ...input(),
      target: { section: 'assets', itemType: 'salary-emoluments' },
    });

    expect(parsed.success).toBe(false);
  });

  it('refuses a content type the gateway cannot read (HEIC)', () => {
    const parsed = extractDocument.input.safeParse({
      ...input(),
      attachment: { ...input().attachment, contentType: 'image/heic' },
    });

    expect(parsed.success).toBe(false);
  });

  it('takes the highly-confidential data class only: a document image cannot be minimised', () => {
    expect(extractDocument.dataClass).toBe('highly-confidential');
  });
});

describe('extract-document request (spec 05b S10)', () => {
  it('sends a digital PDF as its minimised text layer, with no file and no download link', async () => {
    const document = await readDocument(await testPdf([{ lines: TITLE_DEED }]), 'application/pdf');

    const { request } = preparePrompt(extractDocument, 1, input(), 'model', {}, document);

    const sent = JSON.stringify(request.messages);
    for (const identifier of ['WANJIRU', 'KAMAU', '28765432', 'NAKURU/NJORO/1187']) {
      expect(sent).not.toContain(identifier);
    }
    expect(sent).not.toContain('X-Amz-Signature');
    expect(sent).not.toContain('localhost:8333');
    expect(sent).toContain('Approximate Area: 0.405 Ha');
    expect(typeof request.messages[0]?.content).toBe('string');
  });

  it('attaches a scan wrapped as an untrusted document, after the input', async () => {
    const document = await readDocument(TINY_PNG, 'image/png');
    const scan = input({
      attachment: { ...input().attachment, contentType: 'image/png' },
    });

    const { request } = preparePrompt(extractDocument, 1, scan, 'model', {}, document);

    const parts = request.messages[0]?.content as ContentPart[];
    expect(parts.map((part) => part.type)).toEqual(['text', 'text', 'attachment', 'text']);
    expect(textOf(parts.slice(0, 1))).toMatch(/^<untrusted-input>\n[\s\S]*\n<\/untrusted-input>$/u);
    expect(parts[1]).toEqual({ type: 'text', text: '<untrusted-document pages="1">' });
    expect(parts[2]).toEqual({
      type: 'attachment',
      attachment: {
        kind: 'image',
        mediaType: 'image/png',
        data: Buffer.from(TINY_PNG).toString('base64'),
      },
    });
    expect(parts[3]).toEqual({ type: 'text', text: '</untrusted-document>' });
  });

  it("asks for the target item type's fields only", async () => {
    const document = await readDocument(await testPdf([{ lines: TITLE_DEED }]), 'application/pdf');

    const land = preparePrompt(extractDocument, 1, input(), 'model', {}, document).request;
    const vehicle = preparePrompt(
      extractDocument,
      1,
      input({ target: { section: 'assets', itemType: 'vehicle' } }),
      'model',
      {},
      document,
    ).request;

    const names = (schema: unknown) => JSON.stringify(schema).match(/"const":"[^"]+"/gu);
    expect(names(land.schema)).toEqual([
      '"const":"description"',
      '"const":"details.parcelNumber"',
      '"const":"details.size"',
      '"const":"value.kesCents"',
      '"const":"location.inKenya"',
      '"const":"location.county"',
      '"const":"location.country"',
      '"const":"location.detail"',
      '"const":"joint.isJoint"',
      '"const":"joint.sharePercent"',
      '"const":"joint.coOwner"',
    ]);
    expect(names(vehicle.schema)).toContain('"const":"details.registration"');
    expect(names(vehicle.schema)).not.toContain('"const":"details.parcelNumber"');
  });
});

describe('extract-document output', () => {
  const field = (name: string, value: unknown, page: number | null = 1) => ({
    name,
    value,
    confidence: 0.9,
    page,
  });
  const output = (fields: unknown[]) => ({ detectedKind: 'title-deed', fields, warnings: [] });

  it("takes the target item type's fields, typed as declaration.v1 types them", () => {
    const schema = outputSchemaOf(extractDocument, input());

    expect(
      schema.safeParse(
        output([
          field('details.parcelNumber', 'NAKURU/NJORO/1187'),
          field('value.kesCents', 450_000_000, null),
          field('location.county', '032'),
          field('joint.isJoint', false),
        ]),
      ).success,
    ).toBe(true);
    expect(schema.safeParse(output([field('details.registration', 'KDK 482M')])).success).toBe(
      false,
    );
    expect(schema.safeParse(output([field('value.kesCents', '4,500,000')])).success).toBe(false);
    expect(schema.safeParse(output([field('location.county', 'Nakuru')])).success).toBe(false);
  });

  it('fails a reading that names a field twice or holds an account number', () => {
    const validate = (fields: unknown[]) =>
      extractDocument.validate?.(input(), extractDocument.output.parse(output(fields))) ?? [];

    expect(validate([field('description', 'Farm in Njoro')])).toEqual([]);
    expect(validate([field('details.size', '0.405 Ha'), field('details.size', '1 acre')])).toEqual([
      { kind: 'duplicate-field', field: 1 },
    ]);
    expect(validate([field('description', 'Savings account 0102938475610 at KCB')])).toEqual([
      { kind: 'account-number', field: 0 },
    ]);
  });
});
