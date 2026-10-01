import { createHash } from 'node:crypto';

import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { Signer, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import * as asn1js from 'asn1js';
import { PDFDocument } from 'pdf-lib';
import * as pkijs from 'pkijs';

import { IssuanceDependencyUnavailable } from './errors.js';
import type { OpenBao } from './openbao.js';

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  commonName: '2.5.4.3',
} as const;

/** Where the demo CA script (`infra/compose/openbao/create-demo-ca.sh`) keeps the certificate. */
export const SIGNING_CERTIFICATE_KV = { mount: 'secret', path: 'documents/signing/demo' };

/** CMS signatures take about 3.5 KB with the two certificates; room for a longer chain. */
const SIGNATURE_LENGTH = 16_384;

/** The document signing certificate and the chain up to its root, from OpenBao KV. */
export interface SigningCertificates {
  signer: pkijs.Certificate;
  /** The certificates above the signer, up to and including the root. */
  chain: pkijs.Certificate[];
  /** Transit key holding the signer's private key. */
  transitKey: string;
  /** The signer's common name, e.g. `Adili Online (demo)`. */
  signerName: string;
  /** Hex SHA-256 of the signer certificate (DER), recorded with each document it signed. */
  certificateSha256: string;
}

/**
 * PAdES baseline B-B signatures (ETSI EN 319 142-1) over issued PDFs: an invisible signature
 * field with SubFilter `ETSI.CAdES.detached`, whose CMS SignedData carries the content type,
 * message digest and ESS signing-certificate-v2 attributes, signed with RSA PKCS#1 v1.5 and
 * SHA-256 by the Transit key named in KV. The private key never leaves OpenBao.
 */
export class PadesSigner {
  private certificates: Promise<SigningCertificates> | undefined;

  constructor(private readonly openbao: OpenBao) {}

  /** The signing certificates, read once and kept; a failed read is retried on the next call. */
  signingCertificates(): Promise<SigningCertificates> {
    if (!this.certificates) {
      this.certificates = this.loadCertificates();
      this.certificates.catch(() => (this.certificates = undefined));
    }
    return this.certificates;
  }

  /** `pdf` with a PAdES signature claimed at `signingTime` (the PDF's `/M`). */
  async sign(pdf: Buffer, signingTime: Date): Promise<Buffer> {
    const certificates = await this.signingCertificates();
    const document = await PDFDocument.load(pdf);
    pdflibAddPlaceholder({
      pdfDoc: document,
      reason: 'Issued through Adili Online',
      contactInfo: '',
      name: certificates.signerName,
      location: 'Kenya',
      signingTime,
      signatureLength: SIGNATURE_LENGTH,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
      widgetRect: [0, 0, 0, 0],
      appName: 'Adili Online',
    });
    const prepared = Buffer.from(await document.save({ useObjectStreams: false }));
    return new SignPdf().sign(prepared, new TransitCadesSigner(this.openbao, certificates));
  }

  private async loadCertificates(): Promise<SigningCertificates> {
    const secret = await this.openbao.readKv(
      SIGNING_CERTIFICATE_KV.mount,
      SIGNING_CERTIFICATE_KV.path,
    );
    const { certificate, root, transit_key: transitKey } = secret;
    if (!certificate || !root || !transitKey) {
      throw new IssuanceDependencyUnavailable('signer', 'The signing certificate is incomplete');
    }
    const signerDer = pemToDer(certificate);
    const signer = pkijs.Certificate.fromBER(signerDer);
    return {
      signer,
      chain: [pkijs.Certificate.fromBER(pemToDer(root))],
      transitKey,
      signerName: commonName(signer),
      certificateSha256: createHash('sha256').update(signerDer).digest('hex'),
    };
  }
}

/** Builds the CMS SignedData for the bytes signpdf hands over, signing through Transit. */
class TransitCadesSigner extends Signer {
  constructor(
    private readonly openbao: OpenBao,
    private readonly certificates: SigningCertificates,
  ) {
    super();
  }

  override async sign(content: Buffer): Promise<Buffer> {
    const { signer, chain, transitKey } = this.certificates;
    const signerDer = Buffer.from(signer.toSchema().toBER());
    const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 0,
      attributes: [
        new pkijs.Attribute({
          type: OID.contentType,
          values: [new asn1js.ObjectIdentifier({ value: OID.data })],
        }),
        new pkijs.Attribute({
          type: OID.messageDigest,
          values: [new asn1js.OctetString({ valueHex: sha256(content) })],
        }),
        new pkijs.Attribute({
          type: OID.signingCertificateV2,
          values: [signingCertificateV2(signer, signerDer)],
        }),
      ],
    });
    // The signature covers the DER of the attributes as a SET, not as the [0] they are sent in.
    const toSign = new Uint8Array(signedAttrs.toSchema().toBER());
    toSign[0] = 0x31;
    const { signature } = await this.openbao.sign(transitKey, toSign, {
      hashAlgorithm: 'sha2-256',
      signatureAlgorithm: 'pkcs1v15',
    });

    const signerInfo = new pkijs.SignerInfo({
      version: 1,
      sid: new pkijs.IssuerAndSerialNumber({
        issuer: signer.issuer,
        serialNumber: signer.serialNumber,
      }),
      digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
      signedAttrs,
      signatureAlgorithm: new pkijs.AlgorithmIdentifier({
        algorithmId: OID.sha256WithRsa,
        algorithmParams: new asn1js.Null(),
      }),
      signature: new asn1js.OctetString({ valueHex: signature }),
    });
    const signedData = new pkijs.SignedData({
      version: 1,
      digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
      encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
      certificates: [signer, ...chain],
      signerInfos: [signerInfo],
    });
    const contentInfo = new pkijs.ContentInfo({
      contentType: OID.signedData,
      content: signedData.toSchema(true),
    });
    return Buffer.from(contentInfo.toSchema().toBER());
  }
}

/**
 * ESS SigningCertificateV2 (RFC 5035) naming the signer certificate by its SHA-256 (the
 * default hash, so no algorithm) and issuer and serial number, as PAdES B-B requires.
 */
function signingCertificateV2(signer: pkijs.Certificate, signerDer: Buffer): asn1js.Sequence {
  const issuerSerial = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [new pkijs.GeneralName({ type: 4, value: signer.issuer }).toSchema()],
      }),
      signer.serialNumber,
    ],
  });
  const essCertIdV2 = new asn1js.Sequence({
    value: [new asn1js.OctetString({ valueHex: sha256(signerDer) }), issuerSerial],
  });
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] });
}

function sha256(bytes: Uint8Array): ArrayBuffer {
  const digest = createHash('sha256').update(bytes).digest();
  return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
}

function pemToDer(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, ''), 'base64');
}

function commonName(certificate: pkijs.Certificate): string {
  const entry = certificate.subject.typesAndValues.find((each) => each.type === OID.commonName);
  const value = entry?.value.valueBlock.value;
  return typeof value === 'string' && value ? value : 'Adili Online';
}
