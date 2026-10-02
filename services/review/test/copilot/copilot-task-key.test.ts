import { describe, expect, it } from 'vitest';

import { copilotTaskKey } from '../../src/copilot/copilot-requests.js';

describe('copilotTaskKey', () => {
  const parts = {
    task: 'summarize-declaration' as const,
    caseId: '0199b000-0000-7000-8000-0000000000c1',
    versionId: '0199b000-0000-7000-8000-0000000000d1',
    registryCheckedAt: null,
    promptVersion: 1,
    attempt: 1,
  };

  it('is the same for the same request, so a retry gets the same job', () => {
    expect(copilotTaskKey(parts)).toBe(copilotTaskKey({ ...parts }));
  });

  it('names the prompt version: a new prompt version asks anew', () => {
    expect(copilotTaskKey({ ...parts, promptVersion: 2 })).not.toBe(copilotTaskKey(parts));
  });

  it('names the task, the version, the registry check and the request count', () => {
    const key = copilotTaskKey(parts);
    expect(copilotTaskKey({ ...parts, task: 'explain-flags' })).not.toBe(key);
    expect(copilotTaskKey({ ...parts, versionId: parts.caseId })).not.toBe(key);
    expect(copilotTaskKey({ ...parts, registryCheckedAt: '2028-01-20T08:00:00.000Z' })).not.toBe(
      key,
    );
    expect(copilotTaskKey({ ...parts, attempt: 2 })).not.toBe(key);
  });
});
