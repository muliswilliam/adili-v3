import { describe, expect, it } from 'vitest';

import {
  canGoBackTo,
  holdsUpload,
  initialWizardState,
  type WizardAction,
  wizardReducer,
  type WizardState,
} from './import-wizard';

const file = { name: 'roster.xlsx', size: 4_500_000 };
const clean = {
  id: '0199a0b4-0000-7000-8000-000000000001',
  fileName: 'roster.xlsx',
  size: 4_500_000,
};

const run = (actions: WizardAction[], from: WizardState = initialWizardState) =>
  actions.reduce(wizardReducer, from);

const onUpload = run([{ type: 'go', step: 'upload' }]);
const started = run([{ type: 'start', file }], onUpload);

describe('wizardReducer: steps', () => {
  it('starts on the template and moves on to the upload', () => {
    expect(initialWizardState.step).toBe('template');
    expect(onUpload.step).toBe('upload');
  });

  it('does not skip ahead to later steps', () => {
    expect(run([{ type: 'go', step: 'check' }]).step).toBe('template');
    expect(run([{ type: 'go', step: 'check' }], onUpload).step).toBe('upload');
  });

  it('goes back to an earlier step and starts the upload over', () => {
    const atCheck = run(
      [
        { type: 'uploading', attempt: 1 },
        { type: 'scanning', attempt: 1 },
        { type: 'finished', attempt: 1, outcome: { kind: 'clean', upload: clean } },
      ],
      started,
    );
    expect(atCheck.step).toBe('check');

    const back = run([{ type: 'go', step: 'upload' }], atCheck);
    expect(back.step).toBe('upload');
    expect(back.upload).toEqual({ phase: 'idle' });

    expect(run([{ type: 'go', step: 'template' }], atCheck).step).toBe('template');
  });

  it('blocks going back once the import has started', () => {
    const importing: WizardState = { ...initialWizardState, step: 'importing' };
    expect(canGoBackTo(importing, 'check')).toBe(false);
    expect(run([{ type: 'go', step: 'check' }], importing).step).toBe('importing');
    const report: WizardState = { ...initialWizardState, step: 'report' };
    expect(run([{ type: 'go', step: 'template' }], report).step).toBe('report');
  });

  it('lets the stepper select done steps only', () => {
    expect(canGoBackTo(onUpload, 'template')).toBe(true);
    expect(canGoBackTo(onUpload, 'upload')).toBe(false);
    expect(canGoBackTo(onUpload, 'check')).toBe(false);
  });
});

describe('wizardReducer: upload', () => {
  it('runs requesting, uploading with progress, scanning, then clean moves to the check', () => {
    expect(started.upload).toEqual({ phase: 'requesting', file });
    expect(started.attempt).toBe(1);

    const uploading = run(
      [
        { type: 'uploading', attempt: 1 },
        { type: 'progress', attempt: 1, percent: 62 },
      ],
      started,
    );
    expect(uploading.upload).toEqual({ phase: 'uploading', file, percent: 62 });

    const scanning = run([{ type: 'scanning', attempt: 1 }], uploading);
    expect(scanning.upload).toEqual({ phase: 'scanning', file });

    const done = run(
      [{ type: 'finished', attempt: 1, outcome: { kind: 'clean', upload: clean } }],
      scanning,
    );
    expect(done.step).toBe('check');
    expect(done.upload).toEqual({ phase: 'clean', file, upload: clean });
  });

  it.each([
    [{ kind: 'infected' } as const, { phase: 'infected', file }],
    [{ kind: 'rejected', reason: 'type' } as const, { phase: 'rejected', file, reason: 'type' }],
    [{ kind: 'rejected', reason: 'size' } as const, { phase: 'rejected', file, reason: 'size' }],
    [{ kind: 'failed' } as const, { phase: 'failed', file }],
    [{ kind: 'aborted' } as const, { phase: 'idle' }],
    [{ kind: 'unauthenticated' } as const, { phase: 'idle' }],
  ])('stays on the upload step after %o', (outcome, upload) => {
    const next = run([{ type: 'finished', attempt: 1, outcome }], started);
    expect(next.step).toBe('upload');
    expect(next.upload).toEqual(upload);
  });

  it('clamps progress to 0 to 100', () => {
    const uploading = run([{ type: 'uploading', attempt: 1 }], started);
    expect(run([{ type: 'progress', attempt: 1, percent: 140 }], uploading).upload).toMatchObject({
      percent: 100,
    });
  });

  it('ignores events of a cancelled attempt', () => {
    const cancelled = run([{ type: 'uploading', attempt: 1 }, { type: 'reset' }], started);
    expect(cancelled.upload).toEqual({ phase: 'idle' });

    const late = run(
      [
        { type: 'progress', attempt: 1, percent: 80 },
        { type: 'finished', attempt: 1, outcome: { kind: 'clean', upload: clean } },
      ],
      cancelled,
    );
    expect(late).toEqual(cancelled);

    const again = run(
      [
        { type: 'start', file },
        { type: 'uploading', attempt: 1 },
      ],
      cancelled,
    );
    expect(again.attempt).toBe(3);
    expect(again.upload.phase).toBe('requesting');
  });

  it('ignores events of an upload left by going back', () => {
    const left = run([{ type: 'go', step: 'template' }], started);
    expect(
      run(
        [
          { type: 'go', step: 'upload' },
          { type: 'uploading', attempt: 1 },
        ],
        left,
      ).upload,
    ).toEqual({
      phase: 'idle',
    });
  });

  it('does not start a second upload while one is in flight', () => {
    expect(run([{ type: 'start', file: { name: 'other.csv', size: 10 } }], started)).toBe(started);
  });

  it('retries after a failed upload as a new attempt', () => {
    const failed = run([{ type: 'finished', attempt: 1, outcome: { kind: 'failed' } }], started);
    const retried = run([{ type: 'start', file }], failed);
    expect(retried.upload.phase).toBe('requesting');
    expect(retried.attempt).toBe(2);
  });
});

describe('holdsUpload', () => {
  it('is set while a file is on its way up or clean but not imported', () => {
    expect(holdsUpload(initialWizardState)).toBe(false);
    expect(holdsUpload(onUpload)).toBe(false);
    expect(holdsUpload(started)).toBe(true);
    expect(holdsUpload(run([{ type: 'uploading', attempt: 1 }], started))).toBe(true);
    expect(holdsUpload(run([{ type: 'scanning', attempt: 1 }], started))).toBe(true);
    expect(
      holdsUpload(
        run([{ type: 'finished', attempt: 1, outcome: { kind: 'clean', upload: clean } }], started),
      ),
    ).toBe(true);
  });

  it('is clear once the upload has ended without a clean file', () => {
    expect(
      holdsUpload(run([{ type: 'finished', attempt: 1, outcome: { kind: 'infected' } }], started)),
    ).toBe(false);
    expect(
      holdsUpload(run([{ type: 'finished', attempt: 1, outcome: { kind: 'failed' } }], started)),
    ).toBe(false);
  });
});
