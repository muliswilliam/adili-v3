import type { FormMV1 } from '@adili/forms';
import {
  Cancel01Icon,
  Clock01Icon,
  InformationCircleIcon,
  PencilEdit02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { formatDate } from '../lib/format-date';
import { formatNumber } from '../lib/format-number';
import type { AutosaveStatus } from '../lib/use-autosave';
import { Alert, AlertDescription } from './alert';
import { Badge } from './badge';
import { Icon } from './icon';
import { InfoTip } from './info-tip';
import { RateBar } from './rate-bar';
import { SaveIndicator } from './save-indicator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { Textarea } from './textarea';

/** Form M Part II sections 1-3, as `form-m.v1` keys them. */
export type FormMDeclarationSectionKey = 'initial' | 'biennial' | 'final';

export const FORM_M_DECLARATION_SECTIONS: readonly FormMDeclarationSectionKey[] = [
  'initial',
  'biennial',
  'final',
];

/** A section's counts and list as `form-m.v1` holds them; the biennial one may have no cycle. */
export type FormMDeclarationSection = FormMV1['partII']['biennial'];

export type FormMNonFiler = FormMDeclarationSection['nonFilers'][number];

/** The prescribed wording of one section of Form M. */
export interface FormMSectionCopy {
  number: number;
  title: string;
  /** The provision the section reports on, behind the (i). */
  provision: string;
  /** Counts (a) to (c): expected, declared, did not declare. */
  expected: string;
  declared: string;
  notDeclared: string;
  /** (d), the list's caption. */
  list: string;
  dateColumn: string;
}

export const FORM_M_SECTION_COPY: Record<FormMDeclarationSectionKey, FormMSectionCopy> = {
  initial: {
    number: 1,
    title: 'Submission of initial declaration of income, assets and liabilities',
    provision:
      'An initial declaration is required to be made by a public officer within thirty (30) days upon appointment or election to a public office.',
    expected:
      'Number of public officers appointed within the reporting period (newly appointed officers)',
    declared: 'Number of newly appointed public officers who made an initial declaration',
    notDeclared:
      'Number of newly appointed public officers who did not make an initial declaration',
    list: 'List of officers who did not submit initial declaration of income, assets and liabilities',
    dateColumn: 'Date of appointment',
  },
  biennial: {
    number: 2,
    title: 'Submission of biennial declaration of income, assets and liabilities',
    provision:
      'A biennial declaration is required to be made by a public officer once every two years within the period of service as a public officer.',
    expected: 'Number of public officers in the reporting entity within the reporting period',
    declared: 'Number of public officers in the reporting entity who made a biennial declaration',
    notDeclared:
      'Number of public officers in the reporting entity who did not make a biennial declaration',
    list: 'List of officers who did not submit biennial declaration of income, assets and liabilities',
    dateColumn: 'Date of appointment',
  },
  final: {
    number: 3,
    title: 'Submission of final declaration of income, assets and liabilities',
    provision:
      'A final declaration is required to be made by a public officer within thirty (30) days upon ceasing to hold a public office.',
    expected:
      'Number of public officers in the reporting entity who ceased to be public officers within the reporting period',
    declared: 'Number of officers who made a final declaration',
    notDeclared: 'Number of officers who did not make a final declaration',
    list: 'List of public officers who did not submit final declaration of income, assets and liabilities',
    dateColumn: 'Date of exit',
  },
};

export interface FormMSectionMessages {
  /** Replaces any of the prescribed wording, per section. */
  sections: Partial<Record<FormMDeclarationSectionKey, Partial<FormMSectionCopy>>>;
  /** "Section 1(d): {list}". */
  caption: (number: number, list: string) => string;
  /** Names the (i): "About section 1". */
  about: (number: number) => string;
  number: string;
  officer: string;
  actionTaken: string;
  remarks: string;
  /** Names a row's remark field: "Remarks for Jane Wanjiru". */
  remarksFor: (name: string) => string;
  noRemarks: string;
  editedBy: (name: string) => string;
  actions: Record<FormMNonFiler['actionTaken'], string>;
  complied: Record<FormMNonFiler['complied'], string>;
  noneToList: string;
  noCycle: string;
  saving: string;
  saved: string;
  retrying: string;
}

export const FORM_M_SECTION_MESSAGES: FormMSectionMessages = {
  sections: {},
  caption: (number, list) => `Section ${String(number)}(d): ${list}`,
  about: (number) => `About section ${String(number)}`,
  number: 'No.',
  officer: 'Officer',
  actionTaken: 'Action taken / complied',
  remarks: 'Remarks',
  remarksFor: (name) => `Remarks for ${name}`,
  noRemarks: '-',
  editedBy: (name) => `Edited by ${name}`,
  actions: {
    none: 'No action',
    'notice-to-comply': 'Notice to comply',
    warning: 'Warning',
    'salary-stoppage': 'Salary stoppage',
    'disciplinary-referral': 'Disciplinary referral',
    'referred-to-eacc': 'Referred to EACC',
  },
  complied: { yes: 'Complied', pending: 'Pending', no: 'Not complied' },
  noneToList: 'No officers to list.',
  noCycle: 'No biennial cycle in this period.',
  saving: 'Saving…',
  saved: 'Remarks saved',
  retrying: 'Could not save, retrying',
};

const COMPLIED = {
  yes: { variant: 'success', icon: Tick02Icon, strokeWidth: 2.6 },
  pending: { variant: 'warning', icon: Clock01Icon, strokeWidth: 2.2 },
  no: { variant: 'destructive', icon: Cancel01Icon, strokeWidth: 2.4 },
} as const;

export type FormMSectionProps = Omit<ComponentProps<'section'>, 'children'> & {
  section: FormMDeclarationSectionKey;
  /**
   * The section from the Form M document. `nonFilers` holds the rows to show: all of them, or
   * one page with `nonFilersTotal`, `firstRowNumber` and `pagination`.
   */
  data: FormMDeclarationSection;
  /** How many officers the whole list has, when `data.nonFilers` is one page. */
  nonFilersTotal?: number;
  /** The number of the first row shown: 11 on the second page of ten. 1 by default. */
  firstRowNumber?: number;
  /** Under the list, e.g. the console's pager. */
  pagination?: ReactNode;
  /** Makes the remarks editable (the supervisor); called with the row and its new remark. */
  onRemarkChange?: (row: FormMNonFiler, remarks: string) => void;
  /** Who edited a row's remark over the compiled one, if anyone. */
  remarkEditedBy?: (row: FormMNonFiler) => string | null;
  /** Whether the remarks are saved, said in the header. Nothing is said without it. */
  saveStatus?: AutosaveStatus;
  /** Below which the rate is amber, as a share. 0.8 by default. */
  rateThreshold?: number;
  messages?: Partial<FormMSectionMessages>;
};

/**
 * One of Form M's sections 1-3 (initial, biennial, final) as the prescribed form words it: its
 * number and title with the provision behind an (i), counts (a) to (c) in a strip (stacked below
 * 700px of container width), the rate as a `RateBar`, then (d), the officers who did not
 * declare, in a table captioned "Section {n}(d): …". Each row shows the officer, the date,
 * the latest action and whether they complied, and the remark, which `onRemarkChange` makes
 * editable with a field labelled "Remarks for {name}". Long lists come a page at a time.
 */
export function FormMSection({
  section,
  data,
  nonFilersTotal,
  firstRowNumber = 1,
  pagination,
  onRemarkChange,
  remarkEditedBy,
  saveStatus,
  rateThreshold,
  messages,
  className,
  ...props
}: FormMSectionProps) {
  const copy = { ...FORM_M_SECTION_MESSAGES, ...messages };
  const words = { ...FORM_M_SECTION_COPY[section], ...copy.sections[section] };
  const headingId = useId();
  const total = nonFilersTotal ?? data.nonFilers.length;
  const editable = onRemarkChange !== undefined;

  return (
    <section
      aria-labelledby={headingId}
      data-section={section}
      className={cn(
        '@container overflow-hidden rounded-2xl bg-card text-card-foreground shadow-card',
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-3 px-5 pt-[18px] pb-3.5">
        <span
          aria-hidden="true"
          className="grid size-7 flex-none place-items-center rounded-lg bg-muted text-[13.5px] font-semibold"
        >
          {words.number}
        </span>
        <h3
          id={headingId}
          className="min-w-0 pt-0.5 text-[15.5px] leading-[1.35] font-semibold tracking-[-0.01em]"
        >
          {words.title}
          <InfoTip label={copy.about(words.number)} content={words.provision} className="ml-1" />
        </h3>
        {editable && saveStatus && saveStatus !== 'idle' ? (
          <SaveIndicator
            status={saveStatus}
            messages={{ saving: copy.saving, saved: copy.saved, retrying: copy.retrying }}
            className="ml-auto flex-none pt-1 text-[12.5px]"
          />
        ) : null}
      </div>

      {data.noCycleInPeriod ? (
        <Note className="mx-5 mb-5">{copy.noCycle}</Note>
      ) : (
        <>
          <dl className="mx-5 grid grid-cols-1 overflow-hidden rounded-xl shadow-card-flat @min-[700px]:grid-cols-3">
            {(
              [
                ['(a)', words.expected, data.expected],
                ['(b)', words.declared, data.declared],
                ['(c)', words.notDeclared, data.notDeclared],
              ] as const
            ).map(([letter, label, count]) => (
              <div
                key={letter}
                className="flex flex-col gap-1 border-b bg-background/40 px-3.5 py-3 last:border-b-0 @min-[700px]:border-r @min-[700px]:border-b-0 @min-[700px]:last:border-r-0"
              >
                <dt className="text-[12.5px] leading-[1.35] text-muted-foreground">
                  <b className="font-semibold text-secondary-foreground">{letter}</b> {label}
                </dt>
                <dd className="mt-auto text-[22px] font-semibold tracking-[-0.02em] tabular-nums">
                  {formatNumber(count)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="px-5 pt-3 pb-1">
            <RateBar
              size="lg"
              declared={data.declared}
              expected={data.expected}
              showCounts={false}
              threshold={rateThreshold}
            />
          </div>
          {total > 0 ? (
            <div className="mt-3.5 border-t pb-1.5">
              <Table caption={copy.caption(words.number, words.list)} showCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{copy.number}</TableHead>
                    <TableHead>{copy.officer}</TableHead>
                    <TableHead>{words.dateColumn}</TableHead>
                    <TableHead>{copy.actionTaken}</TableHead>
                    <TableHead className="w-[38%]">{copy.remarks}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.nonFilers.map((row, index) => {
                    const editedBy = remarkEditedBy?.(row) ?? null;
                    const complied = COMPLIED[row.complied];
                    return (
                      <TableRow key={row.obligationId ?? `${row.identifier}-${String(index)}`}>
                        <TableCell className="w-9 align-top text-muted-foreground tabular-nums">
                          {`${String(firstRowNumber + index)}.`}
                        </TableCell>
                        <TableCell className="min-w-[170px] align-top">
                          <div className="font-medium">{row.name}</div>
                          <div className="text-[12.5px] text-muted-foreground">
                            {row.designation}
                          </div>
                          <div className="font-mono text-[12.5px] text-muted-foreground">
                            {row.identifier}
                          </div>
                        </TableCell>
                        <TableCell className="align-top whitespace-nowrap">
                          {formatDate(row.date)}
                        </TableCell>
                        <TableCell className="min-w-[150px] align-top">
                          <div
                            className={cn(row.actionTaken === 'none' && 'text-muted-foreground')}
                          >
                            {copy.actions[row.actionTaken]}
                          </div>
                          <Badge variant={complied.variant} className="mt-[5px]">
                            <Icon icon={complied.icon} strokeWidth={complied.strokeWidth} />
                            {copy.complied[row.complied]}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top">
                          {editable ? (
                            <>
                              <Textarea
                                autoGrow
                                rows={2}
                                maxLength={500}
                                aria-label={copy.remarksFor(row.name)}
                                value={row.remarks ?? ''}
                                className={cn(
                                  'min-h-0 min-w-[220px] px-2.5 py-[7px] text-[13.5px] leading-[1.4]',
                                  editedBy && 'shadow-control-hover',
                                )}
                                onChange={(event) => {
                                  onRemarkChange(row, event.target.value);
                                }}
                              />
                              {editedBy ? (
                                <div className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                                  <Icon icon={PencilEdit02Icon} className="size-[11px]" />
                                  {copy.editedBy(editedBy)}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-[13.5px]">
                              {row.remarks?.trim() ? row.remarks : copy.noRemarks}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {pagination}
            </div>
          ) : (
            <Note tone="success" className="mx-5 mt-3.5 mb-5">
              <b className="font-semibold">(d)</b> {copy.noneToList}
            </Note>
          )}
        </>
      )}
    </section>
  );
}

/** A static callout: no live role, as it is not news. */
function Note({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'success';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Alert variant={tone} role={undefined} className={cn('w-auto', className)}>
      <Icon icon={tone === 'success' ? Tick02Icon : InformationCircleIcon} />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
