import { HttpStatus } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { z } from 'zod';

import { TASKS } from '../tasks/registry.js';
import type { TaskDefinition } from '../tasks/task.js';

export const MAX_WAIT_SECONDS = 30;

/** How sensitive the input is; the classification gate decides which providers may see it. */
export const DATA_CLASSES = ['synthetic', 'restricted', 'highly-confidential'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];
export const dataClassSchema = z.enum(DATA_CLASSES);

/** The tenant is not in the body: it is the one the caller acts for (`X-Acting-Tenant`). */
const requestFields = {
  dataClass: dataClassSchema,
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
};

/** Contract `TaskRequest`, with `input` narrowed to the task's own input schema. */
export function taskRequestSchema(task: TaskDefinition) {
  return z.object({
    ...requestFields,
    ...(task.dataClass && {
      dataClass: dataClassSchema.refine((each) => each === task.dataClass, {
        message: `Task ${task.name} takes data class ${task.dataClass} only`,
      }),
    }),
    input: task.input.refine((input) => !containsNul(input), {
      message: 'Text must not contain NUL (U+0000) characters',
    }),
  });
}

/** Contract `TaskRequest`: any task's request; the `{task}` path parameter picks the input. */
export const anyTaskRequestSchema = z.object({
  ...requestFields,
  input: z
    .union(Object.values(TASKS).map((task) => task.input))
    .meta({ description: "The task's input; its `kind` is the task name" }),
});

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

/** Who sends a task request: the tenant it acts for, the calling service, and its key. */
export interface TaskCaller {
  tenant: string;
  principal: Principal;
  idempotencyKey: string;
}

/**
 * Refuses an input sent to the other endpoint: one the task streams (ADR-019) sent as a job
 * (`task-streamed`), or one it runs as a job sent to its stream (`task-not-streamed`).
 */
export function requireEndpoint(
  task: TaskDefinition,
  request: TaskRequest,
  endpoint: 'job' | 'stream',
): void {
  const streamed = task.streamed?.(request.input) ?? false;
  if (streamed === (endpoint === 'stream')) return;
  throw new ProblemException(
    streamed
      ? {
          type: 'task-streamed',
          title: 'Streamed task input',
          status: HttpStatus.BAD_REQUEST,
          detail: `Task ${task.name} answers this input over its stream endpoint, not as a job.`,
        }
      : {
          type: 'task-not-streamed',
          title: 'Task input not streamed',
          status: HttpStatus.BAD_REQUEST,
          detail: `Task ${task.name} runs this input as a job: POST /internal/v1/tasks/${task.name}.`,
        },
  );
}
