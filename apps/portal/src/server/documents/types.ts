import type { components } from './schema.gen';

type Schemas = components['schemas'];

/**
 * The service widens `UploadPurpose` in code as specs add theirs (drafts/documents.yaml), so the
 * contract lists only `roster-import` until #113 adds `declaration-attachment` and spec 07a adds
 * `clarification-attachment`.
 */
export type UploadPurpose =
  Schemas['UploadPurpose'] | 'declaration-attachment' | 'clarification-attachment';

export type CreateUpload = Omit<Schemas['CreateUpload'], 'purpose'> & { purpose: UploadPurpose };
export type Upload = Omit<Schemas['Upload'], 'purpose'> & { purpose: UploadPurpose };
export type UploadRejection = Schemas['UploadRejection'];
export type UploadReservation = Schemas['UploadReservation'];
export type UploadState = Schemas['UploadState'];
