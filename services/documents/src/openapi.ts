import { DeclarationSchema, FormMSchema } from '@adili/forms';
import type { z } from 'zod';

import {
  actionLetterSource,
  clarificationLetterSource,
  decisionLetterSource,
  referralPackageSource,
} from './issuance/pulled-payloads.js';
import {
  disclosureLevelSchema,
  documentDownloadSchema,
  documentStatusSchema,
  documentTypeSchema,
  issueDocumentBody,
  issuedDocumentSchema,
  revocationReasonSchema,
  revokeDocumentBody,
  supersedeDocumentBody,
  watermarkSchema,
} from './issuance/representation.js';
import { accessNilLetterPayload } from './issuance/templates/access-nil-letter.v1.js';
import { accessPackagePayload } from './issuance/templates/access-package.v1.js';
import { acknowledgementSlipPayload } from './issuance/templates/acknowledgement-slip.v1.js';
import { certifiedCopyPayload } from './issuance/templates/certified-copy.v1.js';
import { complianceReportReceiptPayload } from './issuance/templates/compliance-report-receipt.v1.js';
import { formMPayload } from './issuance/templates/form-m.v1.js';
import { ncrPayload } from './issuance/templates/ncr.v1.js';
import { disclosedDeclarationSchema } from './issuance/templates/declaration-content.js';
import { commissionRefSchema } from './issuance/templates/references.js';
import { uploadPurposeSchema } from './uploads/purposes.js';
import {
  createUploadBody,
  internalUploadSchema,
  uploadDownloadSchema,
  uploadRejectionSchema,
  uploadReservationSchema,
  uploadSchema,
  uploadStateSchema,
} from './uploads/representation.js';

const declaration = DeclarationSchema.shape;
const statement = declaration.statements.element.shape;
const formM = FormMSchema.shape;

/** Named schemas of the documents service's OpenAPI document (`#/components/schemas/<name>`). */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  UploadPurpose: uploadPurposeSchema,
  UploadState: uploadStateSchema,
  UploadRejection: uploadRejectionSchema,
  CreateUpload: createUploadBody,
  UploadReservation: uploadReservationSchema,
  Upload: uploadSchema,
  UploadDownload: uploadDownloadSchema,
  DocumentType: documentTypeSchema,
  DisclosureLevel: disclosureLevelSchema,
  DocumentStatus: documentStatusSchema,
  IssueDocument: issueDocumentBody,
  ClarificationLetterSource: clarificationLetterSource,
  DecisionLetterSource: decisionLetterSource,
  ActionLetterSource: actionLetterSource,
  ReferralPackageSource: referralPackageSource,
  SupersedeDocument: supersedeDocumentBody,
  RevocationReason: revocationReasonSchema,
  RevokeDocument: revokeDocumentBody,
  IssuedDocument: issuedDocumentSchema,
  DocumentDownload: documentDownloadSchema,
  Watermark: watermarkSchema,
  CommissionRef: commissionRefSchema,
  AcknowledgementSlipPayload: acknowledgementSlipPayload,
  AccessPackagePayload: accessPackagePayload,
  AccessNilLetterPayload: accessNilLetterPayload,
  CertifiedCopyPayload: certifiedCopyPayload,
  FormMPayload: formMPayload,
  ComplianceReportReceiptPayload: complianceReportReceiptPayload,
  NcrPayload: ncrPayload,
  // Parts of form-m.v1 the Form M payload repeats, named so the contract states them once.
  FormMDeclarationSection: formM.partII.shape.initial,
  FormMSignatory: formM.partIII.shape.compiledBy,
  DisclosedDeclaration: disclosedDeclarationSchema,
  DeclarationV1: DeclarationSchema,
  // Parts of declaration.v1 both payloads print, named so the contract states them once.
  DeclarationOfficer: declaration.officer,
  DeclarationSpouses: declaration.spouses,
  DeclarationChildren: declaration.children,
  DeclarationOtherInformation: declaration.otherInformation,
  DeclarationIncomeItem: statement.income.element,
  DeclarationAssetItem: statement.assets.element,
  DeclarationLiabilityItem: statement.liabilities.element,
  PersonName: statement.personName,
  InternalUpload: internalUploadSchema,
};
