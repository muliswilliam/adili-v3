import type { AssetItem, Attachment, DeclarationV1, Statement } from '@adili/forms';
import {
  Attachment01Icon,
  BankIcon,
  Building03Icon,
  Car01Icon,
  ChartLineData01Icon,
  CheckmarkCircle02Icon,
  CreditCardIcon,
  Download01Icon,
  File02Icon,
  Location01Icon,
  Money01Icon,
  PencilEdit02Icon,
  PieChartIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import {
  assetDetailsLine,
  childLine,
  DECLARATION_LABELS,
  type DeclarationLabels,
  declarationAttachments,
  householdTotals,
  itemAnchorId,
  itemDescriptionLine,
  itemMoney,
  itemsOf,
  personFullName,
  personKind,
  type PersonKind,
  sectionAnchorId,
  spouseLine,
  STATEMENT_CATEGORIES,
  type StatementCategory,
  type StatementItem,
  type StatementTotals,
  statementTotals,
  typeLabel,
} from '../lib/declaration-summary';
import { formatDate, formatDateTime } from '../lib/format-date';
import { formatMoney } from '../lib/money';
import { Avatar, type AvatarTone } from './avatar';
import { Badge } from './badge';
import { Button } from './button';
import { Icon, type IconProps } from './icon';
import { Spinner } from './spinner';

export interface DeclarationSummaryMessages {
  totals: string;
  income: string;
  assets: string;
  liabilities: string;
  total: string;
  personal: string;
  spouses: string;
  noSpouses: string;
  children: string;
  noChildren: string;
  statements: string;
  asAt: (date: string) => string;
  /** (b), (c) and (d) of paragraph 8. */
  category: Record<StatementCategory, string>;
  period: (from: string, to: string) => string;
  nil: string;
  knowledgeLimitation: string;
  other: string;
  materialChanges: string;
  directorships: string;
  memberships: string;
  dualCitizenship: string;
  pendingCases: string;
  freeText: string;
  noneGiven: string;
  attachments: string;
  noAttachments: string;
  download: string;
  downloadAgain: string;
  downloadName: (fileName: string) => string;
  declared: (at: string, version: number | undefined) => string;
  relation: Record<PersonKind, string>;
  fields: {
    surname: string;
    firstName: string;
    otherNames: string;
    dateOfBirth: string;
    placeOfBirth: string;
    maritalStatus: string;
    maritalStatusChange: string;
    postal: string;
    physical: string;
    designation: string;
    employer: string;
    nature: string;
    fileNumber: string;
    jobGroup: string;
    appointmentDate: string;
    workStation: string;
  };
  remunerated: (yes: boolean) => string;
  holdsDualCitizenship: (country: string | undefined, pending: boolean) => string;
}

export const DECLARATION_SUMMARY_MESSAGES: DeclarationSummaryMessages = {
  totals: 'Totals (KES)',
  income: 'Income',
  assets: 'Assets',
  liabilities: 'Liabilities',
  total: 'Total',
  personal: 'Personal and employment details',
  spouses: 'Spouses',
  noSpouses: 'None declared',
  children: 'Dependent children under 18',
  noChildren: 'None declared',
  statements: 'Financial statements',
  asAt: (date) => `as at ${date}`,
  category: { income: '(b) Income', assets: '(c) Assets', liabilities: '(d) Liabilities' },
  period: (from, to) => `${from} to ${to}`,
  nil: 'Nil declared',
  knowledgeLimitation: 'What the declarant knows of this spouse’s affairs',
  other: 'Other information',
  materialChanges: 'Material changes',
  directorships: 'Directorships',
  memberships: 'Memberships',
  dualCitizenship: 'Dual citizenship',
  pendingCases: 'Pending cases',
  freeText: 'Anything else',
  noneGiven: 'None given',
  attachments: 'Attachments',
  noAttachments: 'No attachments',
  download: 'Download',
  downloadAgain: 'Download again',
  downloadName: (fileName) => `Download ${fileName}`,
  declared: (at, version) =>
    `Solemn declaration made online on ${at}${version === undefined ? '' : ` (version ${String(version)})`}.`,
  relation: { declarant: 'Declarant', spouse: 'Spouse', child: 'Child' },
  fields: {
    surname: 'Surname',
    firstName: 'First name',
    otherNames: 'Other names',
    dateOfBirth: 'Date of birth',
    placeOfBirth: 'Place of birth',
    maritalStatus: 'Marital status',
    maritalStatusChange: 'Change since the last declaration',
    postal: 'Postal address',
    physical: 'Physical address',
    designation: 'Designation',
    employer: 'Reporting entity',
    nature: 'Nature of employment',
    fileNumber: 'Personnel file number',
    jobGroup: 'Job group',
    appointmentDate: 'Date of appointment',
    workStation: 'Work station',
  },
  remunerated: (yes) => (yes ? 'Remunerated' : 'Not remunerated'),
  holdsDualCitizenship: (country, pending) =>
    country
      ? `Holds citizenship of ${country}`
      : pending
        ? 'An application for another citizenship is pending'
        : 'None',
};

/** Where an attachment's download stands, for its button. */
export type AttachmentState = 'idle' | 'busy' | 'done';

export interface DeclarationItemContext {
  personKey: string;
  category: StatementCategory;
  item: StatementItem;
}

export type DeclarationSummaryProps = Omit<ComponentProps<'div'>, 'children'> & {
  document: DeclarationV1;
  /** The version number, for the solemn declaration line. */
  version?: number;
  /** The item id or section key to highlight, e.g. after "Go to item". */
  highlight?: string | null;
  /** Under an item's tags, e.g. a button to the indicators on it. */
  itemExtras?: (context: DeclarationItemContext) => ReactNode;
  /** Downloads an attachment; without it, attachments are listed by name only. */
  onAttachment?: (attachment: Attachment) => void;
  /** Where each attachment's download stands, by upload id. */
  attachmentState?: (uploadId: string) => AttachmentState;
  /** Prefix of the anchors' ids (see `anchorIdFor`). */
  anchorPrefix?: string;
  labels?: DeclarationLabels;
  messages?: Partial<DeclarationSummaryMessages>;
};

const TONE: Record<PersonKind, AvatarTone> = {
  declarant: 'brand',
  spouse: 'info',
  child: 'success',
};

const ASSET_ICONS: Record<AssetItem['type'], IconProps['icon']> = {
  land: Location01Icon,
  building: Building03Icon,
  vehicle: Car01Icon,
  securities: ChartLineData01Icon,
  shareholding: PieChartIcon,
  'bank-account': BankIcon,
  cash: Money01Icon,
  receivable: Money01Icon,
  other: File02Icon,
};

function itemIcon(category: StatementCategory, item: StatementItem): IconProps['icon'] {
  if (category === 'income') return Wallet01Icon;
  if (category === 'liabilities') return CreditCardIcon;
  return ASSET_ICONS[(item as AssetItem).type];
}

/** The text, or a dash when there is none. */
function orDash(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return '-';
  return text;
}

function Section({
  id,
  number,
  title,
  aside,
  highlighted,
  children,
}: {
  id?: string;
  number?: string;
  title?: ReactNode;
  aside?: ReactNode;
  highlighted?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-highlighted={highlighted ? true : undefined}
      className={cn(
        'scroll-mt-32 border-b px-5 py-[18px] transition-colors last:border-b-0',
        highlighted && 'bg-brand-faint motion-safe:animate-highlight',
      )}
    >
      {title ? (
        <h3 className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] font-semibold tracking-[-0.01em]">
          {number ? (
            <span className="rounded-sm bg-muted px-[7px] py-0.5 text-[11.5px] font-semibold tracking-[0.02em] text-muted-foreground">
              {number}
            </span>
          ) : null}
          {title}
          {aside ? (
            <span className="text-[13px] font-normal text-muted-foreground">{aside}</span>
          ) : null}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 min-[560px]:grid-cols-2 min-[820px]:grid-cols-3">
      {rows.map(([term, value]) => (
        <div key={term} className="min-w-0">
          <dt className="text-[12.5px] text-muted-foreground">{term}</dt>
          <dd className="mt-0.5 text-[15px] font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Person({ name, kind, lines }: { name: string; kind: PersonKind; lines: string[] }) {
  return (
    <li className="flex items-center gap-2.5">
      <Avatar name={name} tone={TONE[kind]} className="size-7 text-[11.5px]" />
      <div className="min-w-0">
        <div className="font-medium">{name}</div>
        <div className="text-[13px] text-muted-foreground">{lines.join(' · ')}</div>
      </div>
    </li>
  );
}

function AttachmentChip({
  attachment,
  onAttachment,
  state,
  messages,
}: {
  attachment: Attachment;
  onAttachment?: (attachment: Attachment) => void;
  state: AttachmentState;
  messages: DeclarationSummaryMessages;
}) {
  const body = (
    <>
      {state === 'busy' ? <Spinner className="size-3" /> : <Icon icon={Attachment01Icon} />}
      <span className="truncate">{attachment.fileName}</span>
    </>
  );
  const chip =
    'inline-flex h-6 max-w-full items-center gap-[5px] rounded-chip bg-muted px-2 text-xs font-medium text-secondary-foreground [&_svg]:size-3 [&_svg]:shrink-0';
  if (!onAttachment) return <span className={chip}>{body}</span>;
  return (
    <button
      type="button"
      className={cn(chip, 'cursor-pointer hover:bg-border hover:text-foreground')}
      aria-label={messages.downloadName(attachment.fileName)}
      aria-busy={state === 'busy' || undefined}
      onClick={() => {
        onAttachment(attachment);
      }}
    >
      {body}
    </button>
  );
}

function ItemRow({
  context,
  anchorPrefix,
  highlighted,
  labels,
  messages,
  extras,
  onAttachment,
  attachmentState,
}: {
  context: DeclarationItemContext;
  anchorPrefix: string;
  highlighted: boolean;
  labels: DeclarationLabels;
  messages: DeclarationSummaryMessages;
  extras: ReactNode;
  onAttachment?: (attachment: Attachment) => void;
  attachmentState: (uploadId: string) => AttachmentState;
}) {
  const { category, item } = context;
  const details = category === 'assets' ? assetDetailsLine(item as AssetItem) : '';
  const attachments = item.attachments ?? [];
  const change = item.change.changed ? (item.change.kind ?? 'value-change') : null;
  const hasTags = change !== null || attachments.length > 0 || extras;
  return (
    <li
      id={itemAnchorId(item.id, anchorPrefix)}
      data-item-id={item.id}
      data-highlighted={highlighted || undefined}
      className={cn(
        'grid scroll-mt-32 grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t border-border/60 px-3.5 py-2.5 transition-colors first:border-t-0',
        highlighted &&
          'bg-brand-faint shadow-[inset_3px_0_0_var(--color-brand)] motion-safe:animate-highlight',
      )}
    >
      <span className="grid size-8 place-items-center rounded-tile bg-muted text-secondary-foreground">
        <Icon icon={itemIcon(category, item)} className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="text-sm leading-[1.35] font-medium">
          {typeLabel(category, item, labels)}
        </div>
        <div className="mt-px text-[13px] text-muted-foreground">
          {itemDescriptionLine(category, item)}
        </div>
        {details ? <div className="text-[13px] text-muted-foreground">{details}</div> : null}
        {hasTags ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {change ? (
              <Badge variant="info" className="h-[22px] px-2 text-xs">
                <Icon icon={PencilEdit02Icon} className="size-[11px]" />
                {labels.changeTag[change]}
              </Badge>
            ) : null}
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.uploadId}
                attachment={attachment}
                onAttachment={onAttachment}
                state={attachmentState(attachment.uploadId)}
                messages={messages}
              />
            ))}
            {extras}
          </div>
        ) : null}
      </div>
      <div className="text-right text-sm font-semibold whitespace-nowrap tabular-nums">
        {formatMoney(itemMoney(category, item).kesCents, { currency: 'KES' })}
      </div>
    </li>
  );
}

function StatementCard({
  statement,
  name,
  props,
  labels,
  messages,
}: {
  statement: Statement;
  name: string;
  props: Required<Pick<DeclarationSummaryProps, 'anchorPrefix' | 'attachmentState'>> &
    Pick<DeclarationSummaryProps, 'highlight' | 'itemExtras' | 'onAttachment'>;
  labels: DeclarationLabels;
  messages: DeclarationSummaryMessages;
}) {
  const kind = personKind(statement.personKey);
  const sectionKey = `statement:${statement.personKey}`;
  const highlighted = props.highlight === sectionKey;
  const nil = {
    income: statement.incomeNil,
    assets: statement.assetsNil,
    liabilities: statement.liabilitiesNil,
  };
  return (
    <div
      id={sectionAnchorId(sectionKey, props.anchorPrefix)}
      data-highlighted={highlighted || undefined}
      className={cn(
        'mt-3 scroll-mt-32 overflow-hidden rounded-item shadow-card',
        highlighted && 'motion-safe:animate-ring-pulse',
      )}
    >
      <div className="flex items-center gap-2.5 border-b bg-muted/40 px-3.5 py-3">
        <Avatar name={name} tone={TONE[kind]} className="size-7 text-[11.5px]" />
        <div className="min-w-0">
          <h4 className="text-[14.5px] font-semibold">{name}</h4>
          <div className="text-[13px] text-muted-foreground">{messages.relation[kind]}</div>
        </div>
      </div>
      {statement.knowledgeLimitation?.trim() ? (
        <p className="border-b px-3.5 py-2.5 text-[13px] text-secondary-foreground">
          <span className="font-medium">{messages.knowledgeLimitation}:</span>{' '}
          {statement.knowledgeLimitation.trim()}
        </p>
      ) : null}
      {STATEMENT_CATEGORIES.map((category) => {
        const items = itemsOf(statement, category);
        return (
          <div key={category}>
            <h5 className="flex items-baseline gap-2 px-3.5 pt-2.5 pb-1 text-[12.5px] font-semibold text-muted-foreground">
              <span className="text-secondary-foreground">{messages.category[category]}</span>
              {category === 'income' ? (
                <span className="font-medium">
                  {messages.period(
                    formatDate(statement.incomePeriod.from),
                    formatDate(statement.incomePeriod.to),
                  )}
                </span>
              ) : null}
            </h5>
            {items.length === 0 || nil[category] ? (
              <p className="pt-1 pr-3.5 pb-3 pl-[58px] text-[13.5px] text-muted-foreground">
                {messages.nil}
              </p>
            ) : (
              <ul aria-label={`${name}: ${messages.category[category]}`} className="pb-1">
                {items.map((item) => {
                  const context = { personKey: statement.personKey, category, item };
                  return (
                    <ItemRow
                      key={item.id}
                      context={context}
                      anchorPrefix={props.anchorPrefix}
                      highlighted={props.highlight === item.id}
                      labels={labels}
                      messages={messages}
                      extras={props.itemExtras?.(context)}
                      onAttachment={props.onAttachment}
                      attachmentState={props.attachmentState}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OtherInformation({
  document,
  names,
  labels,
  messages,
}: {
  document: DeclarationV1;
  names: (personKey: string | undefined) => string;
  labels: DeclarationLabels;
  messages: DeclarationSummaryMessages;
}) {
  const other = document.otherInformation;
  const interests = other.registrableInterests;
  const blocks: [string, string[]][] = [
    [
      messages.materialChanges,
      other.materialChanges.map((entry) => {
        const thing =
          entry.kind === 'marital-status'
            ? messages.fields.maritalStatus
            : (entry.itemDescription?.trim() ?? '');
        const head = [names(entry.personKey), thing].filter(Boolean).join(' · ');
        return `${head}: ${labels.materialChange[entry.kind]}${entry.explanation.trim() ? ` · ${entry.explanation.trim()}` : ''}`;
      }),
    ],
    [
      messages.directorships,
      interests.directorships.map(
        (each) => `${each.company} · ${each.role} · ${messages.remunerated(each.remunerated)}`,
      ),
    ],
    [
      messages.memberships,
      interests.memberships.map((each) => `${each.entity} · ${labels.membershipKind[each.kind]}`),
    ],
    [
      messages.pendingCases,
      interests.pendingCases.map((each) => `${each.forum} · ${each.reference} · ${each.nature}`),
    ],
  ];
  const dual = interests.dualCitizenship;
  const shown = blocks.filter(([, lines]) => lines.length > 0);
  const free = other.freeText.trim();
  const nothing = shown.length === 0 && !dual.holds && !dual.pendingApplication && !free;
  if (nothing) return <p className="text-sm text-muted-foreground">{messages.noneGiven}</p>;
  return (
    <div className="grid gap-3.5">
      {shown.map(([title, lines]) => (
        <div key={title}>
          <h4 className="text-[12.5px] text-muted-foreground">{title}</h4>
          <ul className="mt-1 grid gap-1 text-sm">
            {lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
      {dual.holds || dual.pendingApplication ? (
        <div>
          <h4 className="text-[12.5px] text-muted-foreground">{messages.dualCitizenship}</h4>
          <p className="mt-1 text-sm">
            {messages.holdsDualCitizenship(
              dual.holds ? dual.country : undefined,
              dual.pendingApplication,
            )}
          </p>
        </div>
      ) : null}
      {free ? (
        <div>
          <h4 className="text-[12.5px] text-muted-foreground">{messages.freeText}</h4>
          <p className="mt-1 text-sm whitespace-pre-line">{free}</p>
        </div>
      ) : null}
    </div>
  );
}

/** A totals cell; on a narrow card, where the header row is hidden, its column labels it. */
const TOTALS_CELL =
  'py-2 pl-2.5 text-right @max-md:py-0 @max-md:pl-0 @max-md:text-left @max-md:before:block @max-md:before:text-[12px] @max-md:before:font-normal @max-md:before:text-muted-foreground @max-md:before:content-[attr(data-label)]';
/** A totals row: a table row, and on a narrow card the person above three labelled amounts. */
const TOTALS_ROW = '@max-md:grid @max-md:grid-cols-3 @max-md:gap-x-2.5 @max-md:gap-y-1.5';

/**
 * Totals per person and for the household. A table where its four columns fit; on a narrow card
 * (a phone, or a narrow pane) each person's name sits above their three amounts, each labelled,
 * rather than the table scrolling sideways out of view.
 */
function TotalsTable({
  messages,
  rows,
  grand,
}: {
  messages: Pick<
    typeof DECLARATION_SUMMARY_MESSAGES,
    'totals' | 'income' | 'assets' | 'liabilities' | 'total'
  >;
  rows: { key: string; person: ReactNode; totals: StatementTotals }[];
  grand: StatementTotals;
}) {
  const amounts = (totals: StatementTotals) =>
    (
      [
        [messages.income, totals.income],
        [messages.assets, totals.assets],
        [messages.liabilities, totals.liabilities],
      ] as const
    ).map(([label, cents]) => (
      <td key={label} data-label={label} className={TOTALS_CELL}>
        {formatMoney(cents)}
      </td>
    ));
  return (
    <div className="@container">
      <table className="w-full border-collapse text-[13.5px] tabular-nums @max-md:block">
        {/* On a narrow card only "Totals (KES)" shows: each amount carries its column's name. */}
        <thead className="@max-md:block">
          <tr className="border-b text-[12.5px] text-muted-foreground @max-md:block">
            <th scope="col" className="py-1.5 text-left font-medium @max-md:block">
              {messages.totals}
            </th>
            <th scope="col" className="py-1.5 pl-2.5 text-right font-medium @max-md:sr-only">
              {messages.income}
            </th>
            <th scope="col" className="py-1.5 pl-2.5 text-right font-medium @max-md:sr-only">
              {messages.assets}
            </th>
            <th scope="col" className="py-1.5 pl-2.5 text-right font-medium @max-md:sr-only">
              {messages.liabilities}
            </th>
          </tr>
        </thead>
        <tbody className="@max-md:block">
          {rows.map((row) => (
            <tr key={row.key} className={cn('border-b', TOTALS_ROW, '@max-md:py-3')}>
              <th
                scope="row"
                className="py-2 text-left font-normal @max-md:col-span-3 @max-md:py-0"
              >
                {row.person}
              </th>
              {amounts(row.totals)}
            </tr>
          ))}
          <tr className={cn('font-semibold', TOTALS_ROW, '@max-md:pt-3')}>
            <th
              scope="row"
              className="pt-2 text-left font-semibold @max-md:col-span-3 @max-md:pt-0"
            >
              {messages.total}
            </th>
            {amounts(grand)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * A declaration as filed (declaration.v1), read-only, in First Schedule order: totals per
 * person, paragraphs 1 to 5, spouses (6), dependent children (7), each person's financial
 * statement (8) with income, assets and liabilities, other information (9), the attachments and
 * the solemn declaration. Items and sections carry anchors (`anchorIdFor`) so a reviewer can be
 * sent to one and see it highlighted; `itemExtras` adds controls to an item, e.g. the indicators
 * pinned to it. Lay it inside a card; it brings its own section padding and hairlines.
 */
export function DeclarationSummary({
  document,
  version,
  highlight = null,
  itemExtras,
  onAttachment,
  attachmentState = () => 'idle',
  anchorPrefix = 'declaration',
  labels = DECLARATION_LABELS,
  messages: overrides,
  className,
  ...props
}: DeclarationSummaryProps) {
  const messages = {
    ...DECLARATION_SUMMARY_MESSAGES,
    ...overrides,
    fields: { ...DECLARATION_SUMMARY_MESSAGES.fields, ...overrides?.fields },
  };
  const { officer, statements } = document;
  const officerName = personFullName(officer.name);
  const nameOf = (statement: Statement) =>
    personFullName(statement.personName) ||
    (statement.personKey === 'officer'
      ? officerName
      : messages.relation[personKind(statement.personKey)]);
  const names = (personKey: string | undefined) => {
    const statement = statements.find((each) => each.personKey === (personKey ?? 'officer'));
    return statement ? nameOf(statement) : officerName;
  };
  const employment = officer.employment;
  const grand = householdTotals(statements);
  const attachments = declarationAttachments(document);
  const shared = { anchorPrefix, attachmentState, highlight, itemExtras, onAttachment };

  const personal: [string, ReactNode][] = [
    [messages.fields.surname, officer.name.surname],
    [messages.fields.firstName, officer.name.firstName],
    [messages.fields.otherNames, orDash(officer.name.otherNames)],
    [messages.fields.dateOfBirth, formatDate(officer.birth.date)],
    [messages.fields.placeOfBirth, officer.birth.place],
    [messages.fields.maritalStatus, labels.maritalStatus[officer.maritalStatus]],
    ...(officer.maritalStatusChange?.changed
      ? ([
          [messages.fields.maritalStatusChange, orDash(officer.maritalStatusChange.explanation)],
        ] as [string, ReactNode][])
      : []),
    [messages.fields.postal, officer.address.postal],
    [messages.fields.physical, officer.address.physical],
    [messages.fields.designation, employment.designation],
    [messages.fields.employer, employment.employer],
    [
      messages.fields.nature,
      employment.nature === 'other' && employment.natureOther?.trim()
        ? employment.natureOther.trim()
        : labels.employmentNature[employment.nature],
    ],
    ...(
      [
        [messages.fields.fileNumber, employment.personnelFileNumber],
        [messages.fields.jobGroup, employment.jobGroup],
        [
          messages.fields.appointmentDate,
          employment.appointmentDate ? formatDate(employment.appointmentDate) : undefined,
        ],
        [messages.fields.workStation, employment.workStation],
      ] as const
    ).flatMap(([term, value]): [string, ReactNode][] => (value?.trim() ? [[term, value]] : [])),
  ];

  return (
    <div className={cn('min-w-0', className)} {...props}>
      <Section>
        <TotalsTable
          messages={messages}
          rows={statements.map((statement) => {
            const name = nameOf(statement);
            return {
              key: statement.personKey,
              person: (
                <span className="flex items-center gap-2">
                  <Avatar
                    name={name}
                    tone={TONE[personKind(statement.personKey)]}
                    className="size-7 shrink-0 text-[11.5px]"
                  />
                  {name}
                </span>
              ),
              totals: statementTotals(statement),
            };
          })}
          grand={grand}
        />
      </Section>

      <Section
        id={sectionAnchorId('bio', anchorPrefix)}
        number="1-5"
        title={messages.personal}
        highlighted={highlight === 'bio'}
      >
        <Fields rows={personal} />
      </Section>

      <div
        id={sectionAnchorId('household', anchorPrefix)}
        data-highlighted={highlight === 'household' || undefined}
        className={cn(
          'scroll-mt-32 border-b',
          highlight === 'household' && 'bg-brand-faint motion-safe:animate-highlight',
        )}
      >
        <Section number="6" title={messages.spouses}>
          {document.spouses.items.length > 0 ? (
            <ul className="grid gap-2.5">
              {document.spouses.items.map((spouse) => (
                <Person
                  key={spouse.id}
                  name={personFullName(spouse.name)}
                  kind="spouse"
                  lines={spouseLine(spouse, labels)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">{messages.noSpouses}</p>
          )}
        </Section>
        <Section number="7" title={messages.children}>
          {document.children.items.length > 0 ? (
            <ul className="grid gap-2.5">
              {document.children.items.map((child) => (
                <Person
                  key={child.id}
                  name={personFullName(child.name)}
                  kind="child"
                  lines={childLine(child)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">{messages.noChildren}</p>
          )}
        </Section>
      </div>

      <Section
        number="8"
        title={messages.statements}
        aside={messages.asAt(formatDate(document.statementDate))}
      >
        {statements.map((statement) => (
          <StatementCard
            key={statement.personKey}
            statement={statement}
            name={nameOf(statement)}
            props={shared}
            labels={labels}
            messages={messages}
          />
        ))}
      </Section>

      <Section
        id={sectionAnchorId('other', anchorPrefix)}
        number="9"
        title={messages.other}
        highlighted={highlight === 'other'}
      >
        <OtherInformation document={document} names={names} labels={labels} messages={messages} />
      </Section>

      <Section
        title={messages.attachments}
        aside={attachments.length > 0 ? String(attachments.length) : undefined}
      >
        {attachments.length > 0 ? (
          <ul className="grid gap-2">
            {attachments.map(({ attachment, personKey, category, item }) => {
              const state = attachmentState(attachment.uploadId);
              return (
                <li
                  key={attachment.uploadId}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 shadow-card"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-secondary-foreground">
                    <Icon icon={File02Icon} className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{attachment.fileName}</div>
                    <div className="truncate text-[13px] text-muted-foreground">
                      {[typeLabel(category, item, labels), item.description, names(personKey)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  {onAttachment ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={messages.downloadName(attachment.fileName)}
                      disabled={state === 'busy'}
                      onClick={() => {
                        onAttachment(attachment);
                      }}
                    >
                      {state === 'busy' ? <Spinner /> : <Icon icon={Download01Icon} />}
                      {state === 'done' ? messages.downloadAgain : messages.download}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">{messages.noAttachments}</p>
        )}
      </Section>

      {document.attestation.declaredAt ? (
        <Section>
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Icon icon={CheckmarkCircle02Icon} className="size-[15px]" />
            {messages.declared(formatDateTime(document.attestation.declaredAt), version)}
          </p>
        </Section>
      ) : null}
    </div>
  );
}
