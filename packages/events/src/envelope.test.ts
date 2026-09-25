import { describe, expect, it } from 'vitest';

import { createEnvelope, eventEnvelopeSchema } from './envelope.js';

describe('createEnvelope', () => {
  it('builds a valid CloudEvents envelope', () => {
    const envelope = createEnvelope('adili/declarations', {
      type: 'declaration.submitted.v1',
      subject: 'DCB-TSC-2027-0012345-K',
      tenant: 'tsc',
      data: { declarationId: '0199a0f2-0000-7000-8000-000000000000' },
    });

    expect(eventEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(envelope.source).toBe('adili/declarations');
  });

  it('gives each event a time-ordered UUIDv7', () => {
    const first = createEnvelope('adili/audit', { type: 'audit.recorded.v1', data: {} });
    const second = createEnvelope('adili/audit', { type: 'audit.recorded.v1', data: {} });

    expect(first.id[14]).toBe('7');
    expect(second.id > first.id).toBe(true);
  });

  it('rejects unversioned event types', () => {
    const envelope = createEnvelope('adili/audit', { type: 'audit.recorded', data: {} });

    expect(eventEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});
