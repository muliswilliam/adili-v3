/**
 * The SHA-256 of a file or bytes as 64 lower-case hex digits, computed on the device with Web
 * Crypto. Nothing is sent anywhere. Web Crypto only exists in a secure context (https or
 * localhost): without it this rejects with `Sha256UnavailableError`.
 */
export async function sha256Hex(data: Blob | BufferSource): Promise<string> {
  // Typed as always there, but missing outside a secure context.
  const subtle: SubtleCrypto | undefined = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) throw new Sha256UnavailableError();
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Web Crypto is missing, as on a page served over plain http from another machine. */
export class Sha256UnavailableError extends Error {
  override readonly name = 'Sha256UnavailableError';

  constructor() {
    super('Web Crypto is not available (not a secure context)');
  }
}

/** Whether two hex digests are the same, ignoring case and spaces. */
export function sameDigest(a: string, b: string): boolean {
  const normalise = (digest: string) => digest.replace(/\s+/g, '').toLowerCase();
  return normalise(a) === normalise(b);
}

/** `9f86d081884c7d65…` → `9f86d081 884c7d65 …`: groups of eight, easier to compare by eye. */
export function formatDigest(digest: string): string {
  return (digest.replace(/\s+/g, '').match(/.{1,8}/g) ?? []).join(' ');
}

const PDF_HEADER = '%PDF-';
// Readers accept the header anywhere in the first 1024 bytes (ISO 32000-2, annex H).
const PDF_HEADER_WINDOW = 1024;

/** Whether the bytes carry a PDF header, as a reader would look for it. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, PDF_HEADER_WINDOW);
  return new TextDecoder('latin1').decode(head).includes(PDF_HEADER);
}
