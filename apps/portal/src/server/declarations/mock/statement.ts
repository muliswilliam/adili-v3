import type { Draft, Statement } from '../../../components/declaration/contents';
import {
  CATEGORIES,
  type Item,
  ITEM_FIELD_ORDER,
  itemFieldPath,
  itemIssues,
  NIL_KEY,
} from '../../../components/declaration/statement';
import { CATEGORY_WORDS } from '../../../components/declaration/labels';
import type { CompletenessIssue } from '../types';
import { issue, type RuleContext } from './context';

/** True when a nil flag is set on a category that has items (400 `nil-conflicts-with-items`). */
export function nilConflictsWithItems(statement: Draft<Statement>): boolean {
  return CATEGORIES.some(
    (category) => statement[NIL_KEY[category]] === true && (statement[category]?.length ?? 0) > 0,
  );
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Paragraph 8 for one person (S7-S9), the rules the statement screen shows: each category
 * needs an item or "Nothing to declare", and each item what `itemIssues` asks for. Messages
 * name the person and the item so the summary's list reads on its own.
 */
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
    const word = CATEGORY_WORDS[category].lower;
    const items: Item[] = statement[category] ?? [];
    if (items.length === 0 && statement[NIL_KEY[category]] !== true) {
      issues.push(
        issue(
          context,
          `/${category}`,
          'category-unanswered',
          `${whose} ${word}: add at least one, or tick "Nothing to declare".`,
        ),
      );
    }
    items.forEach((item, index) => {
      const found = itemIssues(category, item);
      const description = item.description?.trim();
      const name = description ? `"${description}"` : `item ${String(index + 1)}`;
      for (const field of ITEM_FIELD_ORDER[category]) {
        const message = found[field];
        if (!message) continue;
        issues.push(
          issue(
            context,
            `/${category}/${String(index)}${itemFieldPath(category, field)}`,
            'required',
            `${whose} ${word}, ${name}: ${lowerFirst(message)}`,
          ),
        );
      }
    });
  }
  return issues;
}
