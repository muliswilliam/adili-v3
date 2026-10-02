import { answerDeclarantQuestion } from './answer-declarant-question.js';
import { draftClarification } from './draft-clarification.js';
import { explainFlags } from './explain-flags.js';
import { narrateComplianceReport } from './narrate-compliance-report.js';
import { summarizeDeclaration } from './summarize-declaration.js';
import type { TaskDefinition, TaskName } from './task.js';

/**
 * The task registry: task name → input and output schemas and prompt versions (ADR-007).
 * Domain services call these tasks, never models.
 */
export const TASKS: Readonly<Record<TaskName, TaskDefinition>> = {
  'summarize-declaration': summarizeDeclaration,
  'explain-flags': explainFlags,
  'draft-clarification': draftClarification,
  'narrate-compliance-report': narrateComplianceReport,
  'answer-declarant-question': answerDeclarantQuestion,
};

export function findTask(name: string): TaskDefinition | undefined {
  return Object.hasOwn(TASKS, name) ? TASKS[name as TaskName] : undefined;
}
