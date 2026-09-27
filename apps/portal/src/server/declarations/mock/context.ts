import type {
  Draft,
  Household,
  Officer,
  Statement,
} from '../../../components/declaration/contents';
import type { CompletenessIssue, SectionKey } from '../types';

/** What a section's completeness rules can see of the rest of the draft. */
export interface RuleContext {
  key: SectionKey;
  statementDate: string;
  officer: Draft<Officer>;
  household: Draft<Household>;
  /** Live statements by section key. */
  statements: Map<string, Draft<Statement>>;
}

export function issue(
  context: RuleContext,
  path: string,
  code: string,
  message: string,
): CompletenessIssue {
  return { sectionKey: context.key, path, code, message };
}
