import {
  CheckmarkCircle02Icon,
  Clock01Icon,
  UserCheck01Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import { describe, expect, it } from 'vitest';

import type { TimelineEntry } from '../server/review/types';
import { timelineEvents } from './timeline';

const entry = (overrides: Partial<TimelineEntry>): TimelineEntry => ({
  id: 'e',
  kind: 'note-added',
  actor: { subject: 'me', name: 'Faith Achieng' },
  at: '2026-09-25T12:05:00Z',
  summary: 'Internal note added',
  ref: null,
  ...overrides,
});

describe('timelineEvents', () => {
  it('takes the summary as the title and the actor’s name, the system as null', () => {
    expect(timelineEvents([entry({ actor: null, kind: 'case-created' })])[0]).toMatchObject({
      title: 'Internal note added',
      actor: null,
    });
    expect(timelineEvents([entry({})])[0]?.actor).toBe('Faith Achieng');
  });

  it('marks claims, releases and reviewed flags, and keeps the clock for unknown kinds', () => {
    const [claimed, released, reviewed, unknown] = timelineEvents([
      entry({ kind: 'assigned', summary: 'Claimed', ref: 'me' }),
      entry({ kind: 'assigned', summary: 'Released to the queue', ref: null }),
      entry({ kind: 'flag-reviewed' }),
      entry({ kind: 'something-new' }),
    ]);
    expect(claimed).toMatchObject({ icon: UserCheck01Icon, tone: 'info' });
    expect(released).toMatchObject({ icon: UserRemove01Icon });
    expect(reviewed).toMatchObject({ icon: CheckmarkCircle02Icon, tone: 'success' });
    expect(unknown).toMatchObject({ icon: Clock01Icon });
  });
});
