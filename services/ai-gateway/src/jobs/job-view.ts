import { z } from 'zod';

import type { Job } from '../db/schema.js';
import { TASKS } from '../tasks/registry.js';
import { taskNameSchema } from '../tasks/task.js';
import { jobReasonSchema, jobStatusSchema } from './job-states.js';

/** Contract `Job`. `output` is the validated output, present only once the job succeeded. */
export const jobViewSchema = z.object({
  id: z.uuid(),
  task: taskNameSchema,
  tenant: z.string(),
  subjectRef: z.string(),
  status: jobStatusSchema,
  reason: jobReasonSchema.nullable(),
  promptVersion: z.number().int(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  inputHash: z.string(),
  outputHash: z.string().nullable(),
  usage: z.object({
    tokensIn: z.number().int(),
    tokensOut: z.number().int(),
    costMicros: z.number().int().meta({
      description: 'Estimated cost in micro US dollars (USD 1 = 1,000,000) at provider list price',
    }),
    latencyMs: z.number().int(),
  }),
  output: z
    .union([...Object.values(TASKS).map((task) => task.jobOutput), z.null()])
    .meta({ description: "The task's output; null until the job succeeded, or once purged" }),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type JobView = z.infer<typeof jobViewSchema>;

export function toJobView(row: Job): JobView {
  return {
    id: row.id,
    task: row.task,
    tenant: row.tenant,
    subjectRef: row.subjectRef,
    status: row.status,
    reason: row.reason,
    promptVersion: row.promptVersion,
    provider: row.provider,
    model: row.model,
    inputHash: row.inputHash,
    outputHash: row.outputHash,
    usage: {
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      costMicros: row.costMicros,
      latencyMs: row.latencyMs,
    },
    // Stored by the executor from the task's own output schema plus the label.
    output: (row.output ?? null) as JobView['output'],
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
