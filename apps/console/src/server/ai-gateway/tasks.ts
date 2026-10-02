import type { TaskName } from './types';

/** The contract's `TaskName`s: the tasks the ai-gateway runs. */
export const TASK_NAMES = [
  'summarize-declaration',
  'explain-flags',
  'draft-clarification',
  'narrate-compliance-report',
] as const satisfies readonly TaskName[];

/** Compile-time check that every contract task is listed above (the reverse of `satisfies`). */
export const ALL_TASKS_LISTED: TaskName extends (typeof TASK_NAMES)[number] ? true : never = true;

/**
 * Tasks only EACC calls (ADR-007): each has a default route and no Commission's own. The contract
 * does not mark them, so this copies the gateway's `EACC_TASKS`
 * (services/ai-gateway/src/tasks/task.ts).
 */
export const EACC_TASKS = ['narrate-compliance-report'] as const satisfies readonly TaskName[];

/**
 * The tasks a Commission's officers call, and so the tasks a Commission's own route may be added
 * for: every task but EACC's, as the gateway has them.
 */
export const COMMISSION_TASKS = TASK_NAMES.filter(
  (task): task is Exclude<TaskName, (typeof EACC_TASKS)[number]> => isCommissionTask(task),
);

/** Whether a Commission calls `task`, so it may have a route of its own for it. */
export function isCommissionTask(task: TaskName): boolean {
  return !(EACC_TASKS as readonly TaskName[]).includes(task);
}
