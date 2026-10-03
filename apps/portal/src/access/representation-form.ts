import type { AttachmentListItem } from '@adili/ui';

import {
  pointKey,
  type ResponseFile,
  type ResponseForm,
  responseFormReducer,
} from '../clarification/response-form';
import type { UploadsEvent } from '../components/declaration/attachments';
import type {
  Representations,
  RepresentationsInput,
  RepresentationStance,
} from '../server/access/types';

/**
 * The declarant's representations on an access request (spec 10 S4), as pure state: a stance,
 * one text and the documents with it. Files go through the attachment upload flow with the
 * `access-representation` purpose; the access service links them when the response is saved, so
 * a file counts as attached here once it is clean (as in a clarification response, whose file
 * handling this reuses).
 */

/** The contract's limits. */
export const REPRESENTATION_MAX_CHARS = 8000;
export const REPRESENTATION_MAX_FILES = 10;

/** The upload flow's `itemId` for the one text the files hang under. */
const ITEM = pointKey(0);

export interface RepresentationForm {
  stance: RepresentationStance | null;
  text: string;
  files: ResponseFile[];
  /** Send was pressed once, so missing answers show as errors. */
  tried: boolean;
}

export type RepresentationEvent =
  | UploadsEvent
  | { type: 'stance'; stance: RepresentationStance }
  | { type: 'typed'; text: string }
  | { type: 'tried' }
  | { type: 'removed'; id: string };

/** A blank form, or one holding a sent response to edit. */
export function newRepresentationForm(sent: Representations | null = null): RepresentationForm {
  if (!sent) return { stance: null, text: '', files: [], tried: false };
  return {
    stance: sent.stance,
    text: sent.text,
    files: sent.attachments.map((file) => ({
      id: file.uploadId,
      index: 0,
      name: file.fileName,
      // The contract does not say how big a sent file is; it shows without a size.
      size: 0,
      status: 'linked',
      progress: 100,
      uploadId: file.uploadId,
    })),
    tried: false,
  };
}

/** The file events, through the clarification response's reducer with one point. */
function withFiles(
  form: RepresentationForm,
  event: UploadsEvent | { type: 'removed'; id: string },
) {
  const asResponse: ResponseForm = { texts: [form.text], files: form.files, tried: form.tried };
  const next = responseFormReducer(asResponse, event);
  return next === asResponse ? form : { ...form, files: next.files };
}

export function representationReducer(
  form: RepresentationForm,
  event: RepresentationEvent,
): RepresentationForm {
  switch (event.type) {
    case 'stance':
      return form.stance === event.stance ? form : { ...form, stance: event.stance };
    case 'typed':
      return { ...form, text: event.text };
    case 'tried':
      return form.tried ? form : { ...form, tried: true };
    case 'picked':
      return withFiles(form, { ...event, itemId: ITEM });
    default:
      return withFiles(form, event);
  }
}

/** Objecting or adding context needs words; consenting does not. */
export function needsText(stance: RepresentationStance | null): boolean {
  return stance !== null && stance !== 'consent';
}

export type TextError = 'missing' | 'too-long';

export function stanceError(form: RepresentationForm): boolean {
  return form.tried && form.stance === null;
}

export function textError(form: RepresentationForm): TextError | null {
  if (form.text.length > REPRESENTATION_MAX_CHARS) return 'too-long';
  if (form.tried && needsText(form.stance) && !form.text.trim()) return 'missing';
  return null;
}

export function filesChecking(form: RepresentationForm): boolean {
  return form.files.some((file) => file.status === 'uploading' || file.status === 'scanning');
}

export type RepresentationCheck =
  | { status: 'ready'; body: RepresentationsInput }
  | { status: 'stance-missing' }
  | { status: 'text' }
  | { status: 'files-checking' }
  | { status: 'files-not-accepted' };

/** Whether the response can be sent, and the body to send when it can. */
export function checkRepresentations(form: RepresentationForm): RepresentationCheck {
  if (!form.stance) return { status: 'stance-missing' };
  const text = form.text.trim();
  if (form.text.length > REPRESENTATION_MAX_CHARS || (needsText(form.stance) && !text)) {
    return { status: 'text' };
  }
  if (filesChecking(form)) return { status: 'files-checking' };
  if (form.files.some((file) => file.status !== 'linked')) return { status: 'files-not-accepted' };
  return {
    status: 'ready',
    body: {
      stance: form.stance,
      text,
      attachments: form.files.flatMap((file) => (file.uploadId ? [file.uploadId] : [])),
    },
  };
}

/** The rows AttachmentList shows. */
export function attachmentRows(form: RepresentationForm): AttachmentListItem[] {
  return form.files.map((file): AttachmentListItem => ({
    id: file.id,
    name: file.name,
    status: file.status,
    ...(file.status === 'uploading' ? { progress: file.progress } : {}),
    ...(file.status === 'linked' && file.size > 0 ? { size: file.size } : {}),
  }));
}
