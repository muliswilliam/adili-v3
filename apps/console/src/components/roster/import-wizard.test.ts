import { describe, expect, it } from 'vitest';

import {
  canGoBackTo,
  holdsUpload,
  importStarted,
  initialWizardState,
  type WizardAction,
  wizardReducer,
  type WizardState,
  wizardStateFor,
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
    [{ kind: 'rejected', reason: 'empty' } as const, { phase: 'rejected', file, reason: 'empty' }],
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

describe('wizardReducer: import (S24)', () => {
  const importId = '0199a0b4-0000-7000-8000-0000000000aa';
  const atCheck = run(
    [{ type: 'finished', attempt: 1, outcome: { kind: 'clean', upload: clean } }],
    started,
  );
  const importing = run([{ type: 'started', importId }], atCheck);

  it('starts the import from the check of a clean upload only', () => {
    expect(importing.step).toBe('importing');
    expect(importing.importId).toBe(importId);
    expect(importStarted(importing.step)).toBe(true);
    expect(run([{ type: 'started', importId }], onUpload)).toBe(onUpload);
    expect(run([{ type: 'started', importId }], started)).toBe(started);
  });

  it('locks every earlier step once the import has started', () => {
    for (const step of ['template', 'upload', 'check'] as const) {
      expect(canGoBackTo(importing, step)).toBe(false);
      expect(run([{ type: 'go', step }], importing)).toBe(importing);
    }
    expect(holdsUpload(importing)).toBe(false);
  });

  it('ignores late upload events once importing', () => {
    expect(run([{ type: 'progress', attempt: 1, percent: 90 }], importing)).toBe(importing);
    expect(run([{ type: 'reset' }], importing)).toBe(importing);
  });

  it('moves to the report when the import completes', () => {
    const report = run([{ type: 'import-ended', importId, outcome: 'completed' }], importing);
    expect(report.step).toBe('report');
    expect(report.importFailed).toBe(false);
    expect(canGoBackTo(report, 'importing')).toBe(false);
  });

  it('stays on the import step, failed, when the import stops', () => {
    const failed = run([{ type: 'import-ended', importId, outcome: 'failed' }], importing);
    expect(failed.step).toBe('importing');
    expect(failed.importFailed).toBe(true);
  });

  it('ignores the end of another import', () => {
    expect(
      run([{ type: 'import-ended', importId: 'other', outcome: 'completed' }], importing),
    ).toBe(importing);
    expect(run([{ type: 'import-ended', importId, outcome: 'completed' }], atCheck)).toBe(atCheck);
  });

  it('imports another file from the report or a failed import, not while one runs', () => {
    expect(run([{ type: 'import-another' }], importing)).toBe(importing);

    const report = run([{ type: 'import-ended', importId, outcome: 'completed' }], importing);
    const again = run([{ type: 'import-another' }], report);
    expect(again.step).toBe('upload');
    expect(again.upload).toEqual({ phase: 'idle' });
    expect(again.importId).toBeNull();
    // A fresh attempt number, so nothing of the earlier upload can land on the new one.
    expect(again.attempt).toBeGreaterThan(report.attempt);

    const failed = run([{ type: 'import-ended', importId, outcome: 'failed' }], importing);
    expect(run([{ type: 'import-another' }], failed).step).toBe('upload');
  });

  it('reopens an import from the URL on the import step', () => {
    expect(wizardStateFor(undefined)).toBe(initialWizardState);
    const reopened = wizardStateFor(importId);
    expect(reopened.step).toBe('importing');
    expect(reopened.importId).toBe(importId);
    expect(canGoBackTo(reopened, 'template')).toBe(false);
    expect(run([{ type: 'import-ended', importId, outcome: 'completed' }], reopened).step).toBe(
      'report',
    );
  });

  it('follows another import opened from the URL, dropping the upload', () => {
    const other = '0199a0b4-0000-7000-8000-0000000000bb';
    const opened = run([{ type: 'open', importId: other }], atCheck);
    expect(opened.step).toBe('importing');
    expect(opened.importId).toBe(other);
    expect(opened.upload).toEqual({ phase: 'idle' });
    expect(opened.attempt).toBeGreaterThan(atCheck.attempt);
    expect(run([{ type: 'open', importId }], importing)).toBe(importing);
  });

  it('starts over from the template when the followed import cannot be read', () => {
    const restarted = run([{ type: 'restart' }], wizardStateFor(importId));
    expect(restarted.step).toBe('template');
    expect(restarted.importId).toBeNull();
    expect(run([{ type: 'restart' }], atCheck)).toBe(atCheck);
  });
});
