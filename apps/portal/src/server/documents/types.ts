import type { components } from './schema.gen';

type Schemas = components['schemas'];

export type UploadPurpose = Schemas['UploadPurpose'];
export type CreateUpload = Schemas['CreateUpload'];
export type Upload = Schemas['Upload'];
export type UploadRejection = Schemas['UploadRejection'];
export type UploadReservation = Schemas['UploadReservation'];
export type UploadState = Schemas['UploadState'];
