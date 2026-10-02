import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  focusRing,
  formatDate,
  formatDateTime,
  formatMoney,
  Icon,
  type IconProps,
  initialsOf,
  Spinner,
} from '@adili/ui';
import {
  Alert02Icon,
  Attachment01Icon,
  BankIcon,
  Building03Icon,
  Car01Icon,
  ChartLineData01Icon,
  CheckmarkCircle02Icon,
  Coins01Icon,
  CreditCardIcon,
  Download01Icon,
  File02Icon,
  Flag01Icon,
  Invoice01Icon,
  Location01Icon,
  Money01Icon,
  PencilEdit02Icon,
  Refresh01Icon,
  Wallet01Icon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { CaseFlag } from '../../../server/review-case.server';
import {
  CATEGORIES,
  type Category,
  type DeclarationView,
  type DeclaredItem,
  type DeclaredStatement,
  type Relation,
} from '../../../review-case/declaration';
import { topSeverity } from '../../../review-case/flags';
import { declarationAnchorId } from '../copilot/source-refs';
import { messages as t } from './messages';

/**
 * The declaration as filed (spec 07a FE-3), in First Schedule order: household totals, personal
 * and employment details (1-5), spouses (6), dependent children (7), each person's financial
 * statement (8), other information (9) and the attachments. Each section, statement and item
 * carries the id the copilot's source links and "Go to item" scroll to (`declarationAnchorId`);
 * an item with open flags shows how many, and opens them in the Flags tab.
 */

export interface DeclarationPaneProps {
  view: DeclarationView;
  /** "Version 2 of 2". */
  version: string;
  versionNumber: number;
  /** Open flags by item id, for the pins. */
  pins: Map<string, CaseFlag[]>;
  onOpenFlag: (flagId: string) => void;
  onDownload: (uploadId: string, fileName: string) => void;
  /** Uploads whose link is on its way. */
  downloading: ReadonlySet<string>;
}

const kes = (cents: number) => formatMoney(cents);

export function DeclarationPane({
  view,
  version,
  versionNumber,
  pins,
  onOpenFlag,
  onDownload,
  downloading,
}: DeclarationPaneProps) {
  return (
    <DeclarationCard version={version}>
      {view.statements.length > 0 ? <Totals view={view} /> : null}
      <Section
        id={declarationAnchorId({ kind: 'section', section: 'personal' })}
        no="1-5"
        title={t.declaration.personal}
      >
        <dl className="grid grid-cols-1 gap-x-5 gap-y-3.5 min-[560px]:grid-cols-3">
          {view.personal.map((field) => (
            <div key={field.label} className="min-w-0">
              <dt className="text-[13px] text-muted-foreground">{field.label}</dt>
              <dd className="mt-0.5 text-[14.5px] break-words">{field.value || '-'}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section
        id={declarationAnchorId({ kind: 'section', section: 'spouses' })}
        no="6"
        title={t.declaration.spouses}
      >
        <People people={view.spouses} relation="spouse" />
      </Section>
      <Section
        id={declarationAnchorId({ kind: 'section', section: 'children' })}
        no="7"
        title={t.declaration.children}
      >
        <People people={view.children} relation="child" />
      </Section>
      <Section
        no="8"
        title={t.declaration.statements}
        aside={view.statementDate ? t.declaration.asAt(formatDate(view.statementDate)) : null}
      >
        <div className="grid gap-3">
          {view.statements.map((statement) => (
            <StatementCard
              key={statement.personKey}
              statement={statement}
              view={view}
              pins={pins}
              onOpenFlag={onOpenFlag}
              onDownload={onDownload}
              downloading={downloading}
            />
          ))}
        </div>
      </Section>
      <Section
        id={declarationAnchorId({ kind: 'section', section: 'other' })}
        no="9"
        title={t.declaration.other}
      >
        {view.otherInformation.length > 0 ? (
          <ul className="grid gap-1.5 text-sm">
            {view.otherInformation.map((line, index) => (
              <li key={index} className="whitespace-pre-line">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t.declaration.noneGiven}</p>
        )}
      </Section>
      <Section title={t.declaration.attachments} aside={String(view.attachments.length)}>
        {view.attachments.length > 0 ? (
          <ul className="grid gap-2">
            {view.attachments.map((attachment) => (
              <li
                key={attachment.uploadId}
                className="flex min-w-0 items-center gap-2.5 rounded-lg bg-control py-2 pr-1.5 pl-2.5 shadow-control"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-secondary-foreground">
                  <Icon icon={File02Icon} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{attachment.fileName}</div>
                  <div className="truncate text-[12.5px] text-muted-foreground">
                    {attachment.label}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t.declaration.downloadNamed(attachment.fileName)}
                  disabled={downloading.has(attachment.uploadId)}
                  onClick={() => {
                    onDownload(attachment.uploadId, attachment.fileName);
                  }}
                >
                  {downloading.has(attachment.uploadId) ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Icon icon={Download01Icon} />
                  )}
                  {t.declaration.download}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t.declaration.noAttachments}</p>
        )}
      </Section>
      {view.declaredAt ? (
        <div className="px-5 py-4">
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Icon icon={CheckmarkCircle02Icon} className="size-4" />
            {t.declaration.declared(formatDateTime(view.declaredAt), versionNumber)}
          </p>
        </div>
      ) : null}
    </DeclarationCard>
  );
}

/** The pane's card with its sticky title bar. */
export function DeclarationCard({
  version,
  children,
}: {
  version: string | null;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-card shadow-card">
      <div className="sticky top-14 z-[4] flex min-h-[57px] flex-wrap items-center gap-2.5 rounded-t-2xl border-b bg-card/95 px-4 py-3 backdrop-blur-sm">
        <h2 className="text-[14.5px] font-semibold">{t.declaration.title}</h2>
        {version ? <Badge>{version}</Badge> : null}
      </div>
      {children}
    </div>
  );
}

/** The declaration could not be read: the case's own data still shows beside it. */
export function DeclarationUnavailable({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <DeclarationCard version={null}>
      <div className="p-5">
        <Alert
          variant="warning"
          role="alert"
          className="gap-x-4 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:items-center"
        >
          <Icon icon={WifiDisconnected01Icon} />
          <div>
            <AlertTitle>{t.declaration.unavailableTitle}</AlertTitle>
            <AlertDescription className="mt-0.5">{t.declaration.unavailableBody}</AlertDescription>
          </div>
          <div className="mt-2.5 min-[560px]:mt-0 min-[560px]:!pl-0">
            <Button variant="secondary" size="sm" onClick={onRetry} disabled={retrying}>
              {retrying ? <Spinner className="size-4" /> : <Icon icon={Refresh01Icon} />}
              {t.declaration.tryAgain}
            </Button>
          </div>
        </Alert>
      </div>
    </DeclarationCard>
  );
}

/** The document is there but not a `declaration.v1` the console can read. */
export function DeclarationUnreadable() {
  return (
    <DeclarationCard version={null}>
      <div className="p-5">
        <Alert variant="neutral" role="status">
          <Icon icon={Alert02Icon} />
          <AlertTitle>{t.declaration.unreadableTitle}</AlertTitle>
          <AlertDescription>{t.declaration.unreadableBody}</AlertDescription>
        </Alert>
      </div>
    </DeclarationCard>
  );
}

function Section({
  id,
  no,
  title,
  aside,
  children,
}: {
  id?: string;
  no?: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="scroll-mt-[130px] border-b px-5 py-[18px] outline-none last:border-b-0"
    >
      <h3 className="mb-3 flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]">
        {no ? (
          <span className="rounded-md bg-muted px-[7px] py-0.5 text-[11.5px] font-semibold tracking-[0.02em] text-muted-foreground">
            {no}
          </span>
        ) : null}
        {title}
        {aside ? (
          <span className="text-[13px] font-normal text-muted-foreground">{aside}</span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

/** The kit's household avatars: the declarant in brand orange, spouses blue, children green. */
const AVATAR_TONES: Record<Relation, string> = {
  officer: 'from-[#f7b58d] to-brand',
  spouse: 'from-[#a8c7f0] to-[#3a6fc4]',
  child: 'from-[#b9e3c2] to-[#2f9656]',
};

/** A household member's initials, tinted by their place in the household. */
function PersonAvatar({ name, relation }: { name: string; relation: Relation }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full bg-linear-135 text-[11.5px] font-semibold text-white',
        AVATAR_TONES[relation],
      )}
    >
      {initialsOf(name || t.declaration.unnamed)}
    </span>
  );
}

function Totals({ view }: { view: DeclarationView }) {
  const cell = 'py-2 pl-2.5 text-right tabular-nums';
  return (
    <div className="border-b px-5 py-[18px]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b text-[12.5px] text-muted-foreground">
              <th scope="col" className="py-1.5 text-left font-medium">
                {t.declaration.totals}
              </th>
              {CATEGORIES.map((category) => (
                <th key={category} scope="col" className="py-1.5 pl-2.5 text-right font-medium">
                  {CATEGORY_HEADINGS[category]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.statements.map((statement) => (
              <tr key={statement.personKey} className="border-b">
                <th scope="row" className="py-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <PersonAvatar name={statement.name} relation={statement.relation} />
                    <span className="truncate">{statement.name || t.declaration.unnamed}</span>
                  </span>
                </th>
                {CATEGORIES.map((category) => (
                  <td key={category} className={cell}>
                    {kes(statement.totals[category])}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <th scope="row" className="py-2 text-left font-semibold">
                {t.declaration.total}
              </th>
              {CATEGORIES.map((category) => (
                <td key={category} className={cell}>
                  {kes(view.totals[category])}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CATEGORY_HEADINGS: Record<Category, string> = {
  income: 'Income',
  assets: 'Assets',
  liabilities: 'Liabilities',
};

function People({ people, relation }: { people: DeclarationView['spouses']; relation: Relation }) {
  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.declaration.noneDeclared}</p>;
  }
  return (
    <ul className="grid gap-2.5">
      {people.map((person) => (
        <li key={person.id || person.name} className="flex items-center gap-2.5">
          <PersonAvatar name={person.name} relation={relation} />
          <div className="min-w-0">
            <div className="text-[14.5px] font-medium">{person.name || t.declaration.unnamed}</div>
            {person.line ? (
              <div className="text-[13px] text-muted-foreground">{person.line}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatementCard({
  statement,
  view,
  pins,
  onOpenFlag,
  onDownload,
  downloading,
}: {
  statement: DeclaredStatement;
  view: DeclarationView;
} & Pick<DeclarationPaneProps, 'pins' | 'onOpenFlag' | 'onDownload' | 'downloading'>) {
  const headings: Record<Category, { title: string; aside: string | null }> = {
    income: {
      title: t.declaration.income,
      aside: view.incomePeriod
        ? t.declaration.period(formatDate(view.incomePeriod.from), formatDate(view.incomePeriod.to))
        : null,
    },
    assets: { title: t.declaration.assets, aside: null },
    liabilities: { title: t.declaration.liabilities, aside: null },
  };
  return (
    <section
      id={declarationAnchorId({ kind: 'statement', personKey: statement.personKey })}
      aria-label={`${statement.name}, ${statement.relationLabel}`}
      className="scroll-mt-[130px] overflow-hidden rounded-[14px] shadow-card outline-none"
    >
      <div className="flex items-center gap-2.5 border-b bg-background/60 px-3.5 py-3">
        <PersonAvatar name={statement.name} relation={statement.relation} />
        <div className="min-w-0">
          <div className="text-[14.5px] font-semibold">
            {statement.name || t.declaration.unnamed}
          </div>
          <div className="text-[13px] text-muted-foreground">{statement.relationLabel}</div>
        </div>
      </div>
      {CATEGORIES.map((category) => (
        <div key={category}>
          <h4 className="flex items-baseline gap-2 px-3.5 pt-2.5 pb-1 text-[12.5px] font-semibold text-muted-foreground">
            <span className="text-secondary-foreground">{headings[category].title}</span>
            {headings[category].aside ? <span>{headings[category].aside}</span> : null}
          </h4>
          {statement.items[category].length > 0 ? (
            <ul>
              {statement.items[category].map((item, index) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  first={index === 0}
                  flags={pins.get(item.id) ?? []}
                  onOpenFlag={onOpenFlag}
                  onDownload={onDownload}
                  downloading={downloading}
                />
              ))}
            </ul>
          ) : (
            <p className="pt-2 pr-3.5 pb-3 pl-[58px] text-[13.5px] text-muted-foreground">
              {t.declaration.nil}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

const ITEM_ICONS: Record<string, IconProps['icon']> = {
  land: Location01Icon,
  building: Building03Icon,
  vehicle: Car01Icon,
  securities: ChartLineData01Icon,
  shareholding: ChartLineData01Icon,
  'bank-account': BankIcon,
  cash: Money01Icon,
  receivable: Invoice01Icon,
};

function itemIcon(item: DeclaredItem): IconProps['icon'] {
  if (item.category === 'income') return Wallet01Icon;
  if (item.category === 'liabilities') return CreditCardIcon;
  return ITEM_ICONS[item.typeKey] ?? Coins01Icon;
}

const PIN_TONES = {
  high: 'bg-destructive-subtle text-destructive',
  medium: 'bg-warning-subtle text-warning',
  low: 'bg-info-subtle text-info-subtle-foreground',
  info: 'bg-muted text-secondary-foreground',
} as const;

function ItemRow({
  item,
  first,
  flags,
  onOpenFlag,
  onDownload,
  downloading,
}: {
  item: DeclaredItem;
  first: boolean;
  flags: CaseFlag[];
} & Pick<DeclarationPaneProps, 'onOpenFlag' | 'onDownload' | 'downloading'>) {
  const line = [item.description, item.detail].filter(Boolean).join(' · ');
  const severity = flags.length > 0 ? topSeverity(flags) : null;
  const tags = item.changeMark !== null || item.attachments.length > 0 || flags.length > 0;
  return (
    <li
      id={declarationAnchorId({ kind: 'item', itemId: item.id })}
      className={cn(
        'grid scroll-mt-[130px] grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3.5 py-2.5 outline-none',
        !first && 'border-t border-border/60',
      )}
    >
      <span className="grid size-8 place-items-center rounded-[9px] bg-muted text-secondary-foreground">
        <Icon icon={itemIcon(item)} className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="text-sm leading-[1.35] font-medium">{item.type}</div>
        {line ? <div className="mt-px text-[13px] text-muted-foreground">{line}</div> : null}
        {tags ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.changeMark ? (
              <Badge variant="info" className="h-6 text-xs">
                <Icon icon={PencilEdit02Icon} />
                {item.changeMark}
              </Badge>
            ) : null}
            {item.attachments.map((attachment) => (
              <button
                key={attachment.uploadId}
                type="button"
                aria-label={t.declaration.downloadNamed(attachment.fileName)}
                disabled={downloading.has(attachment.uploadId)}
                onClick={() => {
                  onDownload(attachment.uploadId, attachment.fileName);
                }}
                className={cn(
                  focusRing,
                  'inline-flex h-6 max-w-full cursor-pointer items-center gap-[5px] rounded-[7px] bg-muted px-2 text-xs font-medium text-secondary-foreground hover:bg-border/70 hover:text-foreground disabled:cursor-progress',
                )}
              >
                {downloading.has(attachment.uploadId) ? (
                  <Spinner className="size-3" />
                ) : (
                  <Icon icon={Attachment01Icon} className="size-3" />
                )}
                <span className="truncate">{attachment.fileName}</span>
              </button>
            ))}
            {severity && flags[0] ? (
              <button
                type="button"
                aria-label={t.declaration.pinsLabel(flags.length)}
                onClick={() => {
                  if (flags[0]) onOpenFlag(flags[0].id);
                }}
                className={cn(
                  focusRing,
                  'inline-flex h-6 cursor-pointer items-center gap-[5px] rounded-full px-2 text-xs font-semibold',
                  PIN_TONES[severity],
                )}
              >
                <Icon icon={Flag01Icon} className="size-3" strokeWidth={2.2} />
                {t.declaration.pins(flags.length)}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="text-right text-sm font-semibold whitespace-nowrap tabular-nums">
        KES {kes(item.kesCents)}
      </div>
    </li>
  );
}
