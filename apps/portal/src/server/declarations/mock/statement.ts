import type { Draft, Statement } from '../../../components/declaration/contents';
import type { CompletenessIssue } from '../types';
import { issue, type RuleContext } from './context';

const CATEGORIES = [
  { items: 'income', nil: 'incomeNil', word: 'income', amount: 'amount' },
  { items: 'assets', nil: 'assetsNil', word: 'assets', amount: 'value' },
  { items: 'liabilities', nil: 'liabilitiesNil', word: 'liabilities', amount: 'outstanding' },
] as const;

/** True when a nil flag is set on a category that has items (400 `nil-conflicts-with-items`). */
export function nilConflictsWithItems(statement: Draft<Statement>): boolean {
  return CATEGORIES.some(
    (category) => statement[category.nil] === true && (statement[category.items]?.length ?? 0) > 0,
  );
}

/** Paragraph 8 for one person (S7-S9). Refined by the statement screen (#122). */
export function statementCompleteness(
  statement: Draft<Statement>,
  context: RuleContext,
): CompletenessIssue[] {
  const whose =
    context.key === 'statement:officer'
      ? 'Your'
      : `${statement.personName?.firstName ?? 'Their'}'s`;
  const issues: CompletenessIssue[] = [];
  for (const category of CATEGORIES) {
    const items: {
      description?: string;
      change?: { changed?: boolean; kind?: string; explanation?: string };
      amount?: { kesCents?: number };
      value?: { kesCents?: number };
      outstanding?: { kesCents?: number };
    }[] = statement[category.items] ?? [];
    if (items.length === 0 && statement[category.nil] !== true) {
      issues.push(
        issue(
          context,
          `/${category.items}`,
          'category-unanswered',
          `${whose} ${category.word}: add at least one, or tick "Nothing to declare".`,
        ),
      );
    }
    items.forEach((item, index) => {
      const at = `/${category.items}/${String(index)}`;
      if (!item.description?.trim()) {
        issues.push(issue(context, `${at}/description`, 'required', 'Enter a short description.'));
      }
      if (item[category.amount]?.kesCents === undefined) {
        issues.push(issue(context, `${at}/${category.amount}`, 'required', 'Enter the amount.'));
      }
      if (item.change?.changed && !item.change.kind) {
        issues.push(issue(context, `${at}/change/kind`, 'required', 'Choose what changed.'));
      }
      if (item.change?.changed && !item.change.explanation?.trim()) {
        issues.push(issue(context, `${at}/change/explanation`, 'required', 'Explain the change.'));
      }
    });
  }
  return issues;
}
