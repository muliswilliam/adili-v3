import { TENANT_KEY } from '@adili/api-kit';
import { z } from 'zod';

import type { TaskDefinition } from '../tasks/task.js';

export const MAX_WAIT_SECONDS = 30;

/** How sensitive the input is; the classification gate decides which providers may see it. */
export const DATA_CLASSES = ['synthetic', 'restricted', 'highly-confidential'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** Contract `TaskRequest`, with `input` narrowed to the task's own input schema. */
export function taskRequestSchema(task: TaskDefinition) {
  return z.object({
    tenant: z.string().regex(TENANT_KEY),
    dataClass: z.enum(DATA_CLASSES),
    subjectRef: z.string().min(1).max(200).meta({
      description: 'Owning record, e.g. review-case:<uuid>; appears in audit and events',
    }),
    promptVersion: z
      .number()
      .int()
      .positive()
      .nullable()
      .default(null)
      .meta({ description: 'Pin a prompt version; null uses the current one' }),
    waitSeconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).default(0),
    input: task.input.refine((input) => !containsNul(input), {
      message: 'Text must not contain NUL (U+0000) characters',
    }),
  });
}

/** Postgres cannot store U+0000 in jsonb; such input is refused rather than failing on insert. */
function containsNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(containsNul);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, nested]) => key.includes('\u0000') || containsNul(nested),
    );
  }
  return false;
}

export type TaskRequest = z.infer<ReturnType<typeof taskRequestSchema>>;
