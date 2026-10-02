import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Badge, type BadgeProps } from './badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

/**
 * How a registry record relates to the declaration. `matched`: a declared item is the record.
 * `not-declared`: the registry holds it, the declaration does not. `not-in-registry`: the
 * declaration names it, the registry has no such record.
 */
export type MatchRelation = 'matched' | 'not-declared' | 'not-in-registry';

export const MATCH_RELATIONS: readonly MatchRelation[] = [
  'matched',
  'not-declared',
  'not-in-registry',
];

export interface MatchTableRow {
  /** A stable key, e.g. the record's identifier. */
  id: string;
  /**
   * The registry record, e.g. the parcel number or the vehicle registration; the row header.
   * For `not-in-registry`, the identifier the declaration gave.
   */
  record: ReactNode;
  /** The record's details, e.g. "Nyeri · 0.2 ha · freehold · registered 2 Oct 2012". */
  recordDetail?: ReactNode;
  /** Under the record, e.g. a badge for a company on the employer's supplier list. */
  recordNote?: ReactNode;
  /** Shown as a badge in the second column. Leave it out for rows that are not items. */
  relation?: MatchRelation;
  /** The declared item, e.g. its type ("Land"), or a value compared with the declaration. */
  declared?: ReactNode;
  /** The declared item's description. */
  declaredDetail?: ReactNode;
  /** Under the relation, e.g. a "Go to item" link. */
  action?: ReactNode;
}

export interface MatchTableMessages {
  /** The first column. Defaults to "{system} record". */
  recordColumn: (system: string) => string;
  declaredColumn: string;
  /** Names the table for screen readers. Defaults to "{system} records beside the declared items". */
  caption: (system: string) => string;
  /** Shown instead of the table when there are no rows. */
  empty: (system: string) => string;
  /** The row header of a `not-in-registry` row. Defaults to "No record for {record}". */
  noRecord: (record: ReactNode) => ReactNode;
  relations: Record<MatchRelation, string>;
}

export const MATCH_TABLE_MESSAGES: MatchTableMessages = {
  recordColumn: (system) => `${system} record`,
  declaredColumn: 'Declared item',
  caption: (system) => `${system} records beside the declared items`,
  empty: (system) => `${system} has no records for this person.`,
  noRecord: (record) => <>No record for {record}</>,
  relations: {
    matched: 'Matched',
    'not-declared': 'Not declared',
    'not-in-registry': 'Not in registry',
  },
};

const RELATION_VARIANT: Record<MatchRelation, NonNullable<BadgeProps['variant']>> = {
  matched: 'success',
  'not-declared': 'warning',
  'not-in-registry': 'warning',
};

export type MatchTableProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** The registry's name, e.g. "ArdhiSasa". Not translated. */
  system: string;
  rows: MatchTableRow[];
  /** Replaces any of the default copy. */
  messages?: Partial<Omit<MatchTableMessages, 'relations'>> & {
    relations?: Partial<MatchTableMessages['relations']>;
  };
};

const cellPadding = 'px-2.5 py-2 align-top first:pl-2.5 last:pr-2.5';

/**
 * One registry's records beside the declaration: each row's header names the registry record
 * (with its details under it), the second column shows the declared item it matched and the
 * relation as a badge: Matched (green), Not declared or Not in registry (amber). A
 * `not-in-registry` row reads "No record for {identifier}". With no rows it says the registry has
 * no records for this person. For a registry without items (KRA), leave out `relation` and rename
 * the second column with `messages.declaredColumn`.
 */
export function MatchTable({
  system,
  rows,
  messages: overrides,
  className,
  ...props
}: MatchTableProps) {
  const messages = {
    ...MATCH_TABLE_MESSAGES,
    ...overrides,
    relations: { ...MATCH_TABLE_MESSAGES.relations, ...overrides?.relations },
  };

  if (rows.length === 0) {
    return (
      <p className={cn('text-[13px] text-muted-foreground', className)} {...props}>
        {messages.empty(system)}
      </p>
    );
  }

  return (
    <div
      className={cn('overflow-hidden rounded-lg bg-card ring-1 ring-border', className)}
      {...props}
    >
      <Table caption={messages.caption(system)} className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead className="px-2.5 py-2 text-[11.5px] first:pl-2.5 last:pr-2.5">
              {messages.recordColumn(system)}
            </TableHead>
            <TableHead className="px-2.5 py-2 text-[11.5px] first:pl-2.5 last:pr-2.5">
              {messages.declaredColumn}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const missing = row.relation === 'not-in-registry';
            return (
              <TableRow key={row.id} data-relation={row.relation}>
                <TableHead scope="row" className={cellPadding}>
                  <div className={cn('leading-6', missing && 'text-muted-foreground')}>
                    {missing ? messages.noRecord(row.record) : row.record}
                  </div>
                  {row.recordDetail ? (
                    <div className="mt-px text-xs font-normal text-muted-foreground">
                      {row.recordDetail}
                    </div>
                  ) : null}
                  {row.recordNote ? <div className="mt-1">{row.recordNote}</div> : null}
                </TableHead>
                <TableCell className={cellPadding}>
                  {row.declared ? (
                    <div className="leading-6 font-medium">{row.declared}</div>
                  ) : null}
                  {row.declaredDetail ? (
                    <div className="mt-px text-xs text-muted-foreground">{row.declaredDetail}</div>
                  ) : null}
                  {row.relation ? (
                    <Badge
                      variant={RELATION_VARIANT[row.relation]}
                      className={cn(row.declared || row.declaredDetail ? 'mt-1' : null)}
                    >
                      {messages.relations[row.relation]}
                    </Badge>
                  ) : null}
                  {row.action ? <div className="mt-1">{row.action}</div> : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
