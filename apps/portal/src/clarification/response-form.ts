import type { AttachmentListItem, AttachmentStatus } from '@adili/ui';

import type { UploadsEvent } from '../components/declaration/attachments';
import type { ClarificationResponseInput } from '../server/review/types';

/**
 * The declarant's answer to a clarification (spec 07a S14, S20), as pure state: a text per point
 * and the documents attached to each. Files go through the declaration attachment upload flow
 * (`uploadAttachment`), whose events this reducer takes; a file is "linked" here once it is
 * clean, because a clarification attachment is only tied to the response when it is submitted.
 */

/** The contract's limit per point. */
export const RESPONSE_MAX_CHARS = 2000;
/** The contract's limit per point. */
export const RESPONSE_MAX_FILES = 10;

export interface ResponseFile {
  /** Local id until the file has an upload id. */
  id: string;
  index: number;
  name: string;
  size: number;
  status: AttachmentStatus;
  progress: number;
  uploadId: string | null;
}

export interface ResponseForm {
  texts: string[];
  files: ResponseFile[];
  /** Submit was pressed once, so blank answers show as errors. */
  tried: boolean;
}

export type ResponseEvent =
  | UploadsEvent
  | { type: 'typed'; index: number; text: string }
  | { type: 'tried' }
  /** An attached file taken off before submitting. */
  | { type: 'removed'; id: string };

/** The upload flow's `itemId` for a point. */
export function pointKey(index: number): string {
  return `point-${String(index)}`;
}

function indexOf(itemId: string): number {
  return Number(itemId.slice('point-'.length));
}

export function newResponseForm(points: number): ResponseForm {
  return { texts: Array.from({ length: points }, () => ''), files: [], tried: false };
}

function updateFile(
  form: ResponseForm,
  id: string,
  change: (file: ResponseFile) => ResponseFile | null,
): ResponseForm {
  const file = form.files.find((candidate) => candidate.id === id);
  if (!file) return form;
  const next = change(file);
  if (next === file) return form;
  return {
    ...form,
    files: next
      ? form.files.map((candidate) => (candidate.id === id ? next : candidate))
      : form.files.filter((candidate) => candidate.id !== id),
  };
}

export function responseFormReducer(form: ResponseForm, event: ResponseEvent): ResponseForm {
  switch (event.type) {
    case 'typed':
      return {
        ...form,
        texts: form.texts.map((text, i) => (i === event.index ? event.text : text)),
      };
    case 'tried':
      return form.tried ? form : { ...form, tried: true };
    case 'picked': {
      const status: AttachmentStatus =
        event.rejection === 'type'
          ? 'rejected-type'
          : event.rejection === 'size'
            ? 'rejected-size'
            : 'uploading';
      const file: ResponseFile = {
        id: event.id,
        index: indexOf(event.itemId),
        name: event.name,
        size: event.size,
        status,
        progress: 0,
        uploadId: null,
      };
      return { ...form, files: [...form.files, file] };
    }
    case 'progress':
      return updateFile(form, event.id, (file) =>
        file.status === 'uploading' && file.progress !== event.percent
          ? { ...file, progress: event.percent }
          : file,
      );
    case 'scanning':
      return updateFile(form, event.id, (file) =>
        file.status === 'scanning' ? file : { ...file, status: 'scanning' },
      );
    case 'finished':
      return updateFile(form, event.id, (file) => ({ ...file, status: event.outcome }));
    case 'linked':
      return updateFile(form, event.id, (file) => ({
        ...file,
        status: 'linked',
        size: event.size,
        uploadId: event.uploadId,
      }));
    case 'retry':
      return updateFile(form, event.id, (file) =>
        file.status === 'failed' ? { ...file, status: 'uploading', progress: 0 } : file,
      );
    case 'dismissed':
    case 'removed':
      return updateFile(form, event.id, () => null);
    case 'unlinked':
      return { ...form, files: form.files.filter((file) => file.uploadId !== event.uploadId) };
  }
}

export type ItemError = 'missing' | 'too-long';

/** What is wrong with a point's answer: blank (once submit was tried) or too long. */
export function itemError(form: ResponseForm, index: number): ItemError | null {
  const text = form.texts[index] ?? '';
  if (text.length > RESPONSE_MAX_CHARS) return 'too-long';
  if (form.tried && !text.trim()) return 'missing';
  return null;
}

export function answeredCount(form: ResponseForm): number {
  return form.texts.filter((text) => text.trim()).length;
}

/** A file is still uploading or being checked, so the response cannot go yet. */
export function filesChecking(form: ResponseForm): boolean {
  return form.files.some((file) => file.status === 'uploading' || file.status === 'scanning');
}

export type ResponseCheck =
  | { status: 'ready'; items: ClarificationResponseInput['items'] }
  /** The first point whose answer is blank or too long (0-based). */
  | { status: 'unanswered'; index: number }
  | { status: 'files-checking' }
  | { status: 'files-not-accepted' };

/** Whether the response can be submitted, and the body to submit when it can. */
export function checkResponse(form: ResponseForm): ResponseCheck {
  const unanswered = form.texts.findIndex(
    (text) => !text.trim() || text.length > RESPONSE_MAX_CHARS,
  );
  if (unanswered >= 0) return { status: 'unanswered', index: unanswered };
  if (filesChecking(form)) return { status: 'files-checking' };
  if (form.files.some((file) => file.status !== 'linked')) return { status: 'files-not-accepted' };
  return {
    status: 'ready',
    items: form.texts.map((text, index) => ({
      index,
      text: text.trim(),
      attachments: form.files.flatMap((file) =>
        file.index === index && file.uploadId ? [file.uploadId] : [],
      ),
    })),
  };
}

/** The rows AttachmentList shows for one point. */
export function attachmentRowsFor(form: ResponseForm, index: number): AttachmentListItem[] {
  return form.files
    .filter((file) => file.index === index)
    .map((file): AttachmentListItem => ({
      id: file.id,
      name: file.name,
      status: file.status,
      ...(file.status === 'uploading' ? { progress: file.progress } : {}),
      ...(file.status === 'linked' ? { size: file.size } : {}),
    }));
}

/** Clean documents attached across the response, for the confirm dialog. */
export function attachedCount(form: ResponseForm): number {
  return form.files.filter((file) => file.status === 'linked').length;
}
