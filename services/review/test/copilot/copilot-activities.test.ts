import { FieldCipherError } from '@adili/data-access';
import { ApplicationFailure } from '@temporalio/common';
import { describe, expect, it } from 'vitest';

import { CopilotActivities } from '../../src/copilot/activities.js';
import type { CopilotRequests } from '../../src/copilot/copilot-requests.js';

const job = {
  tenant: 'psc',
  caseId: '0199b000-0000-7000-8000-0000000000c1',
  jobId: '0199b000-0000-7000-8000-0000000000a1',
};

/** Activities over requests whose every step fails with `error`. */
function failingWith(error: Error): CopilotActivities {
  const reject = () => Promise.reject(error);
  return new CopilotActivities({
    request: reject,
    settle: reject,
    recordJob: reject,
  } as unknown as CopilotRequests);
}

/** The copilot's activities and the key service's errors (review Q23). */
describe('CopilotActivities', () => {
  it('lets a key service outage through, so the workflow retries it and names the key service', async () => {
    const outage = new FieldCipherError('unavailable', 'OpenBao is sealed');
    await expect(failingWith(outage).recordCopilotJob(job)).rejects.toBe(outage);
  });

  it('reports any other cipher failure as its own error, not retried and not the key service', async () => {
    const activities = failingWith(new FieldCipherError('decryption-failed', 'Tampered'));
    for (const run of [
      () => activities.recordCopilotJob(job),
      () => activities.requestCopilot({ tenant: 'psc', caseId: job.caseId, trigger: 'refresh' }),
      () => activities.settleCopilot({ tenant: 'psc', caseId: job.caseId }),
    ]) {
      const failure = await run().then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(ApplicationFailure);
      expect(failure).toMatchObject({
        type: 'FieldCipherError:decryption-failed',
        nonRetryable: true,
      });
    }
  });

  it('lets every other error through as it is', async () => {
    const bug = new TypeError('a bug');
    await expect(failingWith(bug).settleCopilot(job)).rejects.toBe(bug);
  });
});
