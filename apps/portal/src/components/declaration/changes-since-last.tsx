import {
  Badge,
  Card,
  formatDate,
  formatMoney,
  Icon,
  plural,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { useId, useMemo } from 'react';

import {
  type ChangeRow,
  changeRows,
  type Changes,
  compareStatements,
  statementChanges,
} from '../../declaration/comparison';
import type { Draft, Statement } from '../../declaration/contents';
import { fullName } from '../../declaration/format';
import { OBLIGATION_TYPE_LABELS, TYPE_LABELS } from '../../declaration/labels';
import { OFFICER_KEY } from '../../declaration/section-key';
import type { PreviousDeclaration } from '../../server/declarations.server';
import { OFFICER_LABEL } from './steps';
import type { PreviousLoad } from './use-previous-declaration';

/**
 * What changed since the declarant's previous filed declaration (ADR-006 point 10, EACC story
 * 7), item by item, with the changes Act s.31(4) makes material marked: a value 25% or more up or
 * down, and anything acquired or disposed of. The summary shows it per person; each statement
 * shows its own as the declarant edits it.
 */

export const CHANGES_COPY = {
  title: 'Changes since your last declaration',
  material: 'Material change',
  notMarked: 'Not marked as changed',
  threshold:
    'A change of 25% or more in value, or anything acquired or disposed of, is a material change (Act s.31(4)). Mark each one as changed and explain it.',
  none: 'No changes in value since then.',
  unavailable:
    'Your previous declaration could not be loaded, so changes since it are not shown. Try again later.',
  notDeclared: 'Not declared',
} as const;

/** "Compared with your biennial declaration as at 1 November 2025 (DCB-…)". */
export function comparedWith(previous: PreviousDeclaration): string {
  const type = OBLIGATION_TYPE_LABELS[previous.type].toLowerCase();
  const reference = previous.reference ? ` (${previous.reference})` : '';
  return `Compared with your ${type} declaration as at ${formatDate(previous.statementDate)}${reference}.`;
}

/**
 * A value change as a percentage to one decimal, cut toward zero rather than rounded: the
 * material change badge goes by the exact ratio, so a rise of 24.96% must read "24.9%", not
 * "25.0%" beside no badge. A change too small for one decimal reads "<0.1%", never "0.0%", which
 * would say nothing changed (as `DiffTable` shows it). Computed from the cents, as the row's whole
 * percent is rounded.
 */
function percentText(previousCents: number, currentCents: number): string {
  const delta = Math.abs(currentCents - previousCents);
  const tenths = Math.floor((delta * 1000) / previousCents);
  if (tenths === 0) return '<0.1%';
  return `${(tenths / 10).toFixed(1)}%`;
}

/** "Up 30.0%", "Down 24.9%", "Up <0.1%", "Up from nothing", "New" or "No longer declared". */
export function changeText(row: ChangeRow): string {
  if (row.kind === 'new') return 'New';
  if (row.kind === 'gone') return 'No longer declared';
  // A value change has both sides, and a value that did not move is not a row.
  const { previousCents, currentCents } = row;
  if (!previousCents || currentCents === null) return 'Up from nothing';
  return `${currentCents > previousCents ? 'Up' : 'Down'} ${percentText(previousCents, currentCents)}`;
}

function typeWords(row: ChangeRow) {
  return TYPE_LABELS[row.category][row.type] ?? row.type;
}

/** How many of the changes are material. */
export function materialCount(changes: Changes): number {
  return changes.rows.filter((row) => row.material).length;
}

/** The changes of one statement as a table; "No changes" when there are none. */
export function ChangesTable({ changes, caption }: { changes: Changes; caption: string }) {
  if (changes.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{CHANGES_COPY.none}</p>;
  }
  return (
    <div className="grid gap-1.5">
      <Table caption={caption}>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Then</TableHead>
            <TableHead className="text-right">Now</TableHead>
            <TableHead>Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.rows.map((row, index) => (
            <TableRow key={`${row.kind}:${row.itemId ?? String(index)}`}>
              <TableHead scope="row" className="font-normal">
                <span className="font-medium">{row.description || typeWords(row)}</span>
                {row.description ? (
                  <span className="block text-[13px] text-muted-foreground">{typeWords(row)}</span>
                ) : null}
              </TableHead>
              <TableCell className="text-right tabular-nums">
                {row.previousCents === null
                  ? CHANGES_COPY.notDeclared
                  : formatMoney(row.previousCents)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.currentCents === null
                  ? CHANGES_COPY.notDeclared
                  : formatMoney(row.currentCents)}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{changeText(row)}</span>
                  {row.material ? <Badge variant="warning">{CHANGES_COPY.material}</Badge> : null}
                </div>
                {row.material && row.kind !== 'gone' && !row.markedAsChanged ? (
                  <p className="mt-1 flex items-center gap-1 text-[13px] font-medium text-warning">
                    <Icon icon={Alert02Icon} className="size-3.5 shrink-0" />
                    {CHANGES_COPY.notMarked}
                  </p>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-[13px] text-muted-foreground">
        KES, approximate.
        {changes.unchanged > 0 ? ` ${plural(changes.unchanged, 'item')} unchanged.` : ''}
      </p>
    </div>
  );
}

/** "2 material changes"; nothing when there are none. */
function MaterialBadge({ count }: { count: number }) {
  return count > 0 ? <Badge variant="warning">{plural(count, 'material change')}</Badge> : null;
}

/** Which declaration the changes are against, and what makes one material. */
function ComparedWith({ previous }: { previous: PreviousDeclaration }) {
  return (
    <p className="text-sm text-muted-foreground">
      {comparedWith(previous)} {CHANGES_COPY.threshold}
    </p>
  );
}

/**
 * One statement's changes since the previous declaration, as the declarant edits it. Nothing
 * while the previous declaration loads, or when there is none to compare with.
 */
export function StatementChanges({
  load,
  statement,
  personKey,
}: {
  load: PreviousLoad;
  statement: Draft<Statement>;
  personKey: string;
}) {
  const headingId = useId();
  // The section re-renders on every keystroke; compare again only when the statement or the
  // previous declaration changes.
  const changes = useMemo(
    () =>
      load.status === 'ready'
        ? statementChanges(load.previous.statements, [statement], personKey)
        : null,
    [load, statement, personKey],
  );
  if (load.status === 'loading' || load.status === 'none') return null;
  const material = changes ? materialCount(changes) : 0;
  return (
    <section aria-labelledby={headingId} className="grid gap-3 rounded-lg bg-muted p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="flex-1 font-semibold">
          {CHANGES_COPY.title}
        </h3>
        <MaterialBadge count={material} />
      </header>
      {load.status === 'ready' && changes ? (
        <>
          <ComparedWith previous={load.previous} />
          <ChangesTable changes={changes} caption={CHANGES_COPY.title} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{CHANGES_COPY.unavailable}</p>
      )}
    </section>
  );
}

/**
 * The summary's comparison: every person's changes since the previous declaration, theirs now
 * first and then anyone it had who is no longer declared for. Nothing for a first or initial
 * declaration.
 */
export function DeclarationChanges({
  load,
  statements,
}: {
  load: PreviousLoad;
  statements: readonly Draft<Statement>[];
}) {
  const headingId = useId();
  const previous = load.status === 'ready' ? load.previous : null;
  const persons = useMemo(() => {
    if (!previous) return [];
    const earlier = previous.statements;
    return compareStatements(earlier, statements).map((comparison) => {
      const { personKey } = comparison;
      const statement =
        statements.find((each) => each.personKey === personKey) ??
        earlier.find((each) => each.personKey === personKey);
      return {
        personKey,
        name:
          personKey === OFFICER_KEY
            ? OFFICER_LABEL
            : fullName(statement?.personName) || 'Unnamed person',
        changes: changeRows(comparison),
      };
    });
  }, [previous, statements]);
  if (load.status === 'none') return null;
  const material = persons.reduce((sum, person) => sum + materialCount(person.changes), 0);

  return (
    <Card className="p-0">
      <section aria-labelledby={headingId} className="grid gap-4 p-5">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="grid flex-1 gap-0.5">
            <p className="text-[12.5px] font-medium tracking-wide text-muted-foreground uppercase">
              Paragraphs 8 and 9
            </p>
            <h2 id={headingId} className="text-lg font-semibold tracking-tight">
              {CHANGES_COPY.title}
            </h2>
          </div>
          <MaterialBadge count={material} />
        </header>
        {load.status === 'loading' ? (
          <Skeleton className="h-24" />
        ) : previous ? (
          <>
            <ComparedWith previous={previous} />
            {persons.map((person) => (
              <div key={person.personKey} className="grid gap-2">
                <h3 className="font-semibold">{person.name}</h3>
                <ChangesTable
                  changes={person.changes}
                  caption={`${CHANGES_COPY.title}: ${person.name}`}
                />
              </div>
            ))}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{CHANGES_COPY.unavailable}</p>
        )}
      </section>
    </Card>
  );
}
