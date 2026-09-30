import { createCanvas } from '@napi-rs/canvas';
import * as asn1js from 'asn1js';
import jsQRModule from 'jsqr';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFSignature,
  PDFString,
} from 'pdf-lib';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pkijs from 'pkijs';

// jsQR is CommonJS: its module object is the function its types call the default export.
const jsQR = jsQRModule as unknown as typeof jsQRModule.default;

/**
 * Reading issued PDFs the way a reader and a verifier would: text per page (pdf.js), the QR code
 * in the footer band of each page (rendered and decoded as a scanner does), and the PAdES
 * signature (the signature dictionary with pdf-lib, the CMS with PKI.js).
 */

/** Runs `read` on the parsed document, then releases it. */
async function withDocument<T>(
  pdf: Uint8Array,
  read: (document: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const task = getDocument({ data: new Uint8Array(pdf) });
  try {
    return await read(await task.promise);
  } finally {
    await task.destroy();
  }
}

/** The text of every page, items joined by spaces. */
export function pageTexts(pdf: Uint8Array): Promise<string[]> {
  return withDocument(pdf, async (document) => {
    const texts: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      texts.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' '),
      );
    }
    return texts;
  });
}

/**
 * The QR code payload found in the bottom `band` of each page (the footer), or null for a page
 * without a readable one.
 */
export function footerQrCodes(pdf: Uint8Array, band = 0.2): Promise<(string | null)[]> {
  return withDocument(pdf, async (document) => {
    const codes: (string | null)[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 3 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({
        // pdf.js draws on any 2D canvas; its types name the DOM's.
        canvas: canvas as never,
        canvasContext: context as never,
        viewport,
      }).promise;
      const top = Math.floor(canvas.height * (1 - band));
      const image = context.getImageData(0, top, canvas.width, canvas.height - top);
      codes.push(jsQR(image.data, image.width, image.height)?.data ?? null);
    }
    return codes;
  });
}

export interface PdfSignature {
  subFilter: string;
  byteRange: [number, number, number, number];
  /** The CMS, without the placeholder's zero padding. */
  cms: Uint8Array;
  /** The claimed signing time (`/M`). */
  signingTime: Date | undefined;
  name: string | undefined;
}

/** The signature dictionaries of the document's signature fields. */
export async function pdfSignatures(pdf: Uint8Array): Promise<PdfSignature[]> {
  const document = await PDFDocument.load(pdf);
  return document
    .getForm()
    .getFields()
    .filter((field) => field instanceof PDFSignature)
    .map((field) => {
      const value = field.acroField.dict.lookup(PDFName.of('V'), PDFDict);
      const byteRange = value
        .lookup(PDFName.of('ByteRange'), PDFArray)
        .asArray()
        .map((entry) => (entry as PDFNumber).asNumber());
      const contents = value.lookup(PDFName.of('Contents'), PDFHexString).asBytes();
      const parsed = asn1js.fromBER(contents);
      const signingTime = value.lookupMaybe(PDFName.of('M'), PDFString);
      const name = value.lookupMaybe(PDFName.of('Name'), PDFString);
      return {
        subFilter: value.lookup(PDFName.of('SubFilter'), PDFName).decodeText(),
        byteRange: byteRange as PdfSignature['byteRange'],
        cms: contents.subarray(0, parsed.offset),
        signingTime: signingTime?.decodeDate(),
        name: name?.decodeText(),
      };
    });
}

/** The bytes a signature's ByteRange covers. */
export function signedBytes(pdf: Uint8Array, [a, b, c, d]: PdfSignature['byteRange']): Buffer {
  return Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
}

export interface CmsCheck {
  /** The message digest matches the content and the signature verifies with the signer's key. */
  signatureVerified: boolean;
  /** The signer certificate chains to one of the trusted roots. */
  chainVerified: boolean;
  /** Why verification failed, when it did. */
  failure: string | null;
  /** The first certificate the CMS carries (the signer's). */
  signer: pkijs.Certificate;
  /** OIDs of the signed attributes, in order. */
  signedAttributes: string[];
}

/** Verifies a detached CMS SignedData over `content` against `trustedRoots` (PEM). */
export async function verifyCms(
  cms: Uint8Array,
  content: Uint8Array,
  trustedRoots: string[],
): Promise<CmsCheck> {
  const contentInfo = pkijs.ContentInfo.fromBER(cms);
  const signedData = new pkijs.SignedData({ schema: contentInfo.content });
  const [signer] = signedData.certificates ?? [];
  if (!(signer instanceof pkijs.Certificate)) throw new Error('the CMS carries no certificate');
  const signedAttributes =
    signedData.signerInfos[0]?.signedAttrs?.attributes.map((attribute) => attribute.type) ?? [];
  try {
    const result = await signedData.verify({
      signer: 0,
      data: content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as ArrayBuffer,
      trustedCerts: trustedRoots.map(certificateOf),
      checkChain: true,
      extendedMode: true,
    });
    return {
      signatureVerified: result.signatureVerified === true,
      chainVerified: result.signerCertificateVerified === true,
      failure: null,
      signer,
      signedAttributes,
    };
  } catch (error) {
    // PKI.js throws for a digest or signature that does not match, or a broken chain.
    return {
      signatureVerified: false,
      chainVerified: false,
      failure: error instanceof Error ? error.message : String(error),
      signer,
      signedAttributes,
    };
  }
}

export function certificateOf(pem: string): pkijs.Certificate {
  return pkijs.Certificate.fromBER(
    Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, ''), 'base64'),
  );
}

/** The value of the first attribute `oid` (e.g. `2.5.4.3`, common name) of a name. */
export function nameAttribute(name: pkijs.RelativeDistinguishedNames, oid: string): string {
  return String(name.typesAndValues.find((entry) => entry.type === oid)?.value.valueBlock.value);
}
