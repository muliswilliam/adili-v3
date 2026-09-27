import { z } from 'zod';

import type { TaskDefinition } from '../tasks/task.js';

export const MAX_WAIT_SECONDS = 30;

/** How sensitive the input is; the classification gate decides which providers may see it. */
export const DATA_CLASSES = ['synthetic', 'restricted', 'highly-confidential'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** Contract `TaskRequest`, with `input` narrowed to the task's own input schema. */
export function taskRequestSchema(task: TaskDefinition) {
  return z.object({
    tenant: z.string().regex(/^[a-z][a-z0-9]{1,19}$/),
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
    input: task.input,
  });
}

export type TaskRequest = z.infer<ReturnType<typeof taskRequestSchema>>;
