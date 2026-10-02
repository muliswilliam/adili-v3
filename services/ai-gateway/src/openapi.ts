import type { z } from 'zod';

import { budgetInput, gatePolicyInput } from './admin/admin-input.js';
import { tenantAiStatusSchema } from './admin/tenant-status.js';
import { feedbackInputSchema, feedbackViewSchema } from './feedback/feedback.service.js';
import { jobReasonSchema, jobStatusSchema } from './jobs/job-states.js';
import { jobViewSchema } from './jobs/job-view.js';
import { routeParamsSchema, routeViewSchema } from './jobs/routing.js';
import { anyTaskRequestSchema, dataClassSchema } from './jobs/task-request.js';
import { tenantUsageSchema, usageListSchema } from './policy/budgets.js';
import {
  gateCellSchema,
  gatePolicyListSchema,
  gateRuleSchema,
  tenantGateSchema,
} from './policy/gate-policies.js';
import { providerClassSchema } from './providers/port.js';
import { changeInput, flagInput, registryStatusInput, sourceRef } from './tasks/common.js';
import { draftClarification } from './tasks/draft-clarification.js';
import { explainFlags } from './tasks/explain-flags.js';
import { narrateComplianceReport } from './tasks/narrate-compliance-report.js';
import { summarizeDeclaration } from './tasks/summarize-declaration.js';
import { aiLabelSchema, taskNameSchema } from './tasks/task.js';

/**
 * Named schemas of the ai-gateway's OpenAPI document (`#/components/schemas/<name>`), which is
 * exported to packages/schemas/internal/ai-gateway.yaml by `pnpm contracts`. Each task's input
 * and output are the schemas the gateway validates with: `<Task>Output` is what the model must
 * return (sent to the provider as JSON Schema) plus the gateway's `label`.
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  TaskName: taskNameSchema,
  DataClass: dataClassSchema,
  ProviderClass: providerClassSchema,
  JobStatus: jobStatusSchema,
  JobReason: jobReasonSchema,
  TaskRequest: anyTaskRequestSchema,
  Job: jobViewSchema,
  AiLabel: aiLabelSchema,
  SourceRef: sourceRef,
  FlagInput: flagInput,
  ChangeInput: changeInput,
  RegistryStatusInput: registryStatusInput,
  SummarizeDeclarationInput: summarizeDeclaration.input,
  SummarizeDeclarationOutput: summarizeDeclaration.jobOutput,
  ExplainFlagsInput: explainFlags.input,
  ExplainFlagsOutput: explainFlags.jobOutput,
  DraftClarificationInput: draftClarification.input,
  DraftClarificationOutput: draftClarification.jobOutput,
  NarrateComplianceReportInput: narrateComplianceReport.input,
  NarrateComplianceReportOutput: narrateComplianceReport.jobOutput,
  FeedbackInput: feedbackInputSchema,
  Feedback: feedbackViewSchema,
  TenantAiStatus: tenantAiStatusSchema,
  GateRuleInput: gateCellSchema,
  GatePolicyInput: gatePolicyInput,
  GateRule: gateRuleSchema,
  TenantPolicy: tenantGateSchema,
  GatePolicyList: gatePolicyListSchema,
  RouteParams: routeParamsSchema,
  Route: routeViewSchema,
  BudgetInput: budgetInput,
  TenantUsage: tenantUsageSchema,
  UsageList: usageListSchema,
};
