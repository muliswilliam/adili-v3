import { describe, expect, it } from 'vitest';

import {
  answeredCount,
  attachmentRowsFor,
  checkResponse,
  filesChecking,
  itemError,
  newResponseForm,
  pointKey,
  type ResponseEvent,
  type ResponseForm,
  responseFormReducer,
  RESPONSE_MAX_CHARS,
} from './response-form';

const UPLOAD_A = '5a0e2f7c-1b9d-4c3e-8f6a-000000000001';
const UPLOAD_B = '5a0e2f7c-1b9d-4c3e-8f6a-000000000002';

function run(form: ResponseForm, ...events: ResponseEvent[]): ResponseForm {
  return events.reduce(responseFormReducer, form);
}

function picked(id: string, index: number, name = `${id}.pdf`): ResponseEvent {
  return { type: 'picked', id, itemId: pointKey(index), name, size: 1000, rejection: null };
}

describe('response form', () => {
  it('starts with an empty answer per point and counts the answered ones', () => {
    const form = run(newResponseForm(3), { type: 'typed', index: 1, text: '  Sold in May  ' });
    expect(form.texts).toEqual(['', '  Sold in May  ', '']);
    expect(answeredCount(form)).toBe(1);
  });

  it('flags a blank answer only once submit was tried, and a long one at once', () => {
    let form = newResponseForm(2);
    expect(itemError(form, 0)).toBeNull();
    form = run(form, { type: 'tried' });
    expect(itemError(form, 0)).toBe('missing');
    const long = run(newResponseForm(1), {
      type: 'typed',
      index: 0,
      text: 'x'.repeat(RESPONSE_MAX_CHARS + 1),
    });
    expect(itemError(long, 0)).toBe('too-long');
  });

  it('names the first point that needs an answer', () => {
    const form = run(newResponseForm(3), { type: 'typed', index: 0, text: 'Answered' });
    expect(checkResponse(form)).toEqual({ status: 'unanswered', index: 1 });
    const tooLong = run(
      newResponseForm(2),
      { type: 'typed', index: 0, text: 'x'.repeat(RESPONSE_MAX_CHARS + 1) },
      { type: 'typed', index: 1, text: 'fine' },
    );
    expect(checkResponse(tooLong)).toEqual({ status: 'unanswered', index: 0 });
  });

  it('builds the response from trimmed text and the attached uploads of each point', () => {
    const form = run(
      newResponseForm(2),
      { type: 'typed', index: 0, text: ' Inherited from my father. ' },
      { type: 'typed', index: 1, text: 'Corrected value below.' },
      picked('row-a', 0),
      { type: 'scanning', id: 'row-a' },
      { type: 'linked', id: 'row-a', uploadId: UPLOAD_A, size: 1000 },
      picked('row-b', 0),
      { type: 'linked', id: 'row-b', uploadId: UPLOAD_B, size: 1000 },
    );
    expect(checkResponse(form)).toEqual({
      status: 'ready',
      items: [
        { index: 0, text: 'Inherited from my father.', attachments: [UPLOAD_A, UPLOAD_B] },
        { index: 1, text: 'Corrected value below.', attachments: [] },
      ],
    });
  });

  it('waits for files still uploading or being checked', () => {
    const form = run(
      newResponseForm(1),
      { type: 'typed', index: 0, text: 'Answer' },
      picked('row-a', 0),
      { type: 'scanning', id: 'row-a' },
    );
    expect(filesChecking(form)).toBe(true);
    expect(checkResponse(form)).toEqual({ status: 'files-checking' });
  });

  it('refuses to submit while a file that was not accepted is still listed', () => {
    const form = run(
      newResponseForm(1),
      { type: 'typed', index: 0, text: 'Answer' },
      picked('row-a', 0, 'virus.pdf'),
      { type: 'finished', id: 'row-a', outcome: 'infected' },
    );
    expect(checkResponse(form)).toEqual({ status: 'files-not-accepted' });
    const dismissed = run(form, { type: 'dismissed', id: 'row-a' });
    expect(checkResponse(dismissed).status).toBe('ready');
  });

  it('lists each point’s files for AttachmentList and drops a removed one', () => {
    let form = run(
      newResponseForm(2),
      picked('row-a', 0, 'deed.pdf'),
      { type: 'progress', id: 'row-a', percent: 40 },
      picked('row-b', 1, 'photo.png'),
      { type: 'linked', id: 'row-b', uploadId: UPLOAD_B, size: 2048 },
    );
    expect(attachmentRowsFor(form, 0)).toEqual([
      { id: 'row-a', name: 'deed.pdf', status: 'uploading', progress: 40 },
    ]);
    expect(attachmentRowsFor(form, 1)).toEqual([
      { id: 'row-b', name: 'photo.png', status: 'linked', size: 2048 },
    ]);
    form = run(form, { type: 'removed', id: 'row-b' });
    expect(attachmentRowsFor(form, 1)).toEqual([]);
  });

  it('marks a file the browser refused before any upload', () => {
    const form = run(newResponseForm(1), {
      type: 'picked',
      id: 'row-a',
      itemId: pointKey(0),
      name: 'notes.docx',
      size: 10,
      rejection: 'type',
    });
    expect(attachmentRowsFor(form, 0)[0]?.status).toBe('rejected-type');
  });
});
