import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CorpusImporter } from '../../src/help/corpus-importer.js';

/** An importer whose import fails `failures` times, then succeeds. */
function importer(failures: number) {
  const subject = new CorpusImporter({} as never, { load: () => [] }, {} as never);
  let left = failures;
  const run = vi.spyOn(subject, 'run').mockImplementation(() => {
    if (left > 0) {
      left -= 1;
      return Promise.reject(new Error('timeout exceeded when trying to connect'));
    }
    return Promise.resolve({ skipped: true } as never);
  });
  return { subject, run };
}

describe('CorpusImporter on boot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tries the import again after a failure, so a stalled first connect does not fail the boot', async () => {
    const { subject, run } = importer(2);

    const booted = subject.onApplicationBootstrap();
    await vi.runAllTimersAsync();

    await expect(booted).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('fails the boot when every attempt fails', async () => {
    const { subject, run } = importer(10);

    const booted = subject.onApplicationBootstrap();
    const failed = expect(booted).rejects.toThrow('timeout exceeded when trying to connect');
    await vi.runAllTimersAsync();

    await failed;
    expect(run).toHaveBeenCalledTimes(4);
  });
});
