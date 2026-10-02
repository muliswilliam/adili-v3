import { z } from 'zod';

/** review.yaml `Assignee`: an officer as views name them. */
export const assigneeSchema = z.object({ subject: z.string(), name: z.string() });
export type Assignee = z.infer<typeof assigneeSchema>;

/** An officer as a view names them: the name their token gave, else their subject. */
export function officer(subject: string | null, name: string | null): Assignee | null {
  return subject === null ? null : { subject, name: name ?? subject };
}
