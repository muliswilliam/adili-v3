import type { components } from './schema.gen';

type Schemas = components['schemas'];

/**
 * The service widens `UploadPurpose` in code as specs add theirs (internal/documents.yaml), so the
 * contract lacks `clarification-attachment` until spec 07a adds it.
 */
export type UploadPurpose = Schemas['UploadPurpose'] | 'clarification-attachment';

export type CreateUpload = Omit<Schemas['CreateUpload'], 'purpose'> & { purpose: UploadPurpose };
export type Upload = Omit<Schemas['Upload'], 'purpose'> & { purpose: UploadPurpose };
export type UploadRejection = Schemas['UploadRejection'];
export type UploadReservation = Schemas['UploadReservation'];
export type UploadState = Schemas['UploadState'];
