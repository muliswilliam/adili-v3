import { RosterFileError } from '../sheet.js';
import { DocumentsUnavailable, UploadNotClean, UploadNotFound } from './roster-uploads.js';

/**
 * Why a roster upload could not be read: the one classification of the errors `RosterUploads`
 * and the file parser throw, which the import's staging (as the import's failure) and the HTTP
 * routes (as problems) each report in their own words.
 */
export type UploadFailureKind = 'not-found' | 'not-clean' | 'unreadable' | 'unavailable';

export interface UploadFailure {
  kind: UploadFailureKind;
  /** The error's message; for `unreadable`, what is wrong with the file, fit to show. */
  detail: string;
}

const KINDS: readonly [abstract new (...args: never[]) => Error, UploadFailureKind][] = [
  [UploadNotFound, 'not-found'],
  [UploadNotClean, 'not-clean'],
  [RosterFileError, 'unreadable'],
  [DocumentsUnavailable, 'unavailable'],
];

/** The failure `error` stands for, or undefined for any other error. */
export function uploadFailureOf(error: unknown): UploadFailure | undefined {
  const found = KINDS.find(([type]) => error instanceof type);
  return found && { kind: found[1], detail: (error as Error).message };
}
