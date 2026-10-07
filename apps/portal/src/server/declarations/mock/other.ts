import {
  type ChangeFlag,
  type Draft,
  followsEarlierDeclaration,
  type MaterialChangeEntry,
  type OtherInformation,
} from '../../../declaration/contents';
import { FLAGGED_INTERESTS, type Interests, interestChanges } from '../../../declaration/other';
import type { CompletenessIssue } from '../types';
import { issue, type RuleContext } from './context';

/** A change flag set on a directorship or membership, and the JSON pointer it sits at. */
interface FlaggedInterest {
  path: string;
  change: Draft<ChangeFlag>;
}

/**
 * The declarant's directorships and memberships flagged as changed since the last declaration;
 * none on an initial declaration.
 */
function flaggedInterests(other: Draft<OtherInformation>, context: RuleContext): FlaggedInterest[] {
  if (!followsEarlierDeclaration(context.type)) return [];
  const interests: Interests = other.registrableInterests ?? {};
  return FLAGGED_INTERESTS.flatMap(({ list }) =>
    (interests[list] ?? []).flatMap(({ change }, index) =>
      change?.changed
        ? [{ path: `/registrableInterests/${list}/${String(index)}/change`, change }]
        : [],
    ),
  );
}

/** A string with something in it besides spaces. */
const filled = (value: string | undefined): value is string => Boolean(value?.trim());

/**
 * Paragraph 9's material changes, composed from the marital status change, flagged items and
 * the declarant's flagged directorships and memberships, in that order.
 */
export function composeMaterialChanges(
  context: RuleContext,
  other: Draft<OtherInformation>,
): MaterialChangeEntry[] {
  const entries: MaterialChangeEntry[] = [];
  const marital = context.officer.maritalStatusChange;
  if (marital?.changed && filled(marital.explanation)) {
    entries.push({
      personKey: 'officer',
      kind: 'marital-status',
      explanation: marital.explanation,
    });
  }
  for (const statement of context.statements.values()) {
    for (const items of [statement.income, statement.assets, statement.liabilities]) {
      for (const item of items ?? []) {
        if (item.change?.changed && filled(item.change.kind) && filled(item.change.explanation)) {
          entries.push({
            ...(statement.personKey ? { personKey: statement.personKey } : {}),
            ...(item.id ? { itemId: item.id } : {}),
            ...(item.description ? { itemDescription: item.description } : {}),
            kind: item.change.kind,
            explanation: item.change.explanation,
          });
        }
      }
    }
  }
  if (followsEarlierDeclaration(context.type)) {
    entries.push(...interestChanges(other.registrableInterests ?? {}).map(({ entry }) => entry));
  }
  return entries;
}

/** A change flag that is set says what kind of change it was and explains it. */
function changeRules(
  context: RuleContext,
  at: string,
  change: Draft<ChangeFlag>,
): CompletenessIssue[] {
  return [
    ...(filled(change.kind)
      ? []
      : [
          issue(
            context,
            `${at}/kind`,
            'required',
            'Choose what changed since your last declaration.',
          ),
        ]),
    ...(filled(change.explanation)
      ? []
      : [
          issue(
            context,
            `${at}/explanation`,
            'required',
            'Explain what changed since your last declaration.',
          ),
        ]),
  ];
}

/**
 * Paragraph 9 (S11): each interest card complete, dual citizenship answered (with the country
 * when held) and free text within 4,000 characters. Messages are what the Other information
 * screen and the summary show.
 */
export function otherCompleteness(
  other: Draft<OtherInformation>,
  context: RuleContext,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  const interests = other.registrableInterests;
  // A flagged directorship or membership says what kind of change it was and explains it,
  // listed first as the service lists them.
  for (const { path, change } of flaggedInterests(other, context)) {
    issues.push(...changeRules(context, path, change));
  }
  interests?.directorships?.forEach((entry, index) => {
    if (!entry.company?.trim() || !entry.role?.trim() || entry.remunerated === undefined) {
      issues.push(
        issue(
          context,
          `/registrableInterests/directorships/${String(index)}`,
          'required',
          `Directorship ${String(index + 1)}: enter the company, your role and whether it is paid.`,
        ),
      );
    }
  });
  interests?.memberships?.forEach((entry, index) => {
    if (!entry.entity?.trim() || !entry.kind) {
      issues.push(
        issue(
          context,
          `/registrableInterests/memberships/${String(index)}`,
          'required',
          `Membership ${String(index + 1)}: enter the name and the kind of body.`,
        ),
      );
    }
  });
  const dual = interests?.dualCitizenship;
  if (dual?.holds === undefined) {
    issues.push(
      issue(
        context,
        '/registrableInterests/dualCitizenship/holds',
        'required',
        'Say whether you hold another citizenship.',
      ),
    );
  } else if (dual.holds && !dual.country) {
    issues.push(
      issue(
        context,
        '/registrableInterests/dualCitizenship/country',
        'required',
        'Choose the other country of citizenship.',
      ),
    );
  }
  if (dual?.pendingApplication === undefined) {
    issues.push(
      issue(
        context,
        '/registrableInterests/dualCitizenship/pendingApplication',
        'required',
        'Say whether you have a pending citizenship application.',
      ),
    );
  }
  interests?.pendingCases?.forEach((entry, index) => {
    if (!entry.forum?.trim() || !entry.reference?.trim() || !entry.nature?.trim()) {
      issues.push(
        issue(
          context,
          `/registrableInterests/pendingCases/${String(index)}`,
          'required',
          `Pending case ${String(index + 1)}: enter the court or body, case reference and nature.`,
        ),
      );
    }
  });
  if ((other.freeText?.length ?? 0) > 4000) {
    issues.push(
      issue(context, '/freeText', 'too-long', 'Keep "Anything else" to 4,000 characters.'),
    );
  }
  return issues;
}
