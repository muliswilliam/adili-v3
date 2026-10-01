import { describe, expect, it } from 'vitest';

import {
  attachmentRows,
  checkRepresentations,
  newRepresentationForm,
  REPRESENTATION_MAX_CHARS,
  type RepresentationEvent,
  type RepresentationForm,
  representationReducer,
  stanceError,
  textError,
} from './representation-form';

const run = (events: RepresentationEvent[], start: RepresentationForm = newRepresentationForm()) =>
  events.reduce(representationReducer, start);

const UPLOAD = 'c0de0000-0000-4000-8000-000000000009';

describe('the representations form (S4)', () => {
  it('asks for a stance first, then words to object or add context', () => {
    const tried = run([{ type: 'tried' }]);
    expect(stanceError(tried)).toBe(true);
    expect(checkRepresentations(tried)).toEqual({ status: 'stance-missing' });

    const objecting = run([{ type: 'stance', stance: 'object' }], tried);
    expect(textError(objecting)).toBe('missing');
    expect(checkRepresentations(objecting)).toEqual({ status: 'text' });

    const context = run(
      [
        { type: 'stance', stance: 'context' },
        { type: 'typed', text: '  ' },
      ],
      tried,
    );
    expect(textError(context)).toBe('missing');
  });

  it('lets consent go without words, and refuses more than the limit', () => {
    expect(checkRepresentations(run([{ type: 'stance', stance: 'consent' }]))).toEqual({
      status: 'ready',
      body: { stance: 'consent', text: '', attachments: [] },
    });
    const long = run([
      { type: 'stance', stance: 'object' },
      { type: 'typed', text: 'x'.repeat(REPRESENTATION_MAX_CHARS + 1) },
    ]);
    expect(textError(long)).toBe('too-long');
    expect(checkRepresentations(long)).toEqual({ status: 'text' });
  });

  it('waits for documents to be checked and refuses ones that were not accepted', () => {
    const picked = run([
      { type: 'stance', stance: 'object' },
      { type: 'typed', text: ' In court. ' },
      {
        type: 'picked',
        id: 'f1',
        itemId: 'anything',
        name: 'Notice.pdf',
        size: 2048,
        rejection: null,
      },
    ]);
    expect(checkRepresentations(picked)).toEqual({ status: 'files-checking' });
    expect(attachmentRows(picked)).toEqual([
      { id: 'f1', name: 'Notice.pdf', status: 'uploading', progress: 0 },
    ]);

    const clean = run([{ type: 'linked', id: 'f1', uploadId: UPLOAD, size: 2048 }], picked);
    expect(checkRepresentations(clean)).toEqual({
      status: 'ready',
      body: { stance: 'object', text: 'In court.', attachments: [UPLOAD] },
    });
    expect(attachmentRows(clean)).toEqual([
      { id: 'f1', name: 'Notice.pdf', status: 'linked', size: 2048 },
    ]);

    const infected = run([{ type: 'finished', id: 'f1', outcome: 'infected' }], picked);
    expect(checkRepresentations(infected)).toEqual({ status: 'files-not-accepted' });
    expect(checkRepresentations(run([{ type: 'removed', id: 'f1' }], infected)).status).toBe(
      'ready',
    );
  });

  it('starts an edit from the sent response, its documents attached', () => {
    const form = newRepresentationForm({
      stance: 'context',
      text: 'Earlier words.',
      attachments: [{ uploadId: UPLOAD, fileName: 'Minutes.pdf' }],
      submittedAt: '2026-09-30T07:00:00Z',
      updatedAt: '2026-09-30T07:00:00Z',
    });
    expect(attachmentRows(form)).toEqual([{ id: UPLOAD, name: 'Minutes.pdf', status: 'linked' }]);
    expect(checkRepresentations(form)).toEqual({
      status: 'ready',
      body: { stance: 'context', text: 'Earlier words.', attachments: [UPLOAD] },
    });
  });
});
