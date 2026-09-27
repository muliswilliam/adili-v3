import {
  Alert,
  AlertDescription,
  Button,
  Card,
  formatDate,
  formatDateTime,
  formatMoney,
  Icon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import {
  Alert02Icon,
  CloudSavingDone01Icon,
  PencilEdit02Icon,
  SentIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { getDeclarationSummary } from '../../server/declarations';
import type { LoadedSummary } from '../../server/declarations.server';
import type { DeclarationSection } from '../../server/declarations/types';
import { isSaving } from './autosave';
import { CompletenessBadge } from './completeness-badge';
import type { Draft, Statement } from './contents';
import { DiscardDraftButton } from './discard-dialog';
import { fullName, orUnanswered, UNANSWERED } from './format';
import {
  ASSET_TYPE_LABELS,
  EMPLOYMENT_NATURE_LABELS,
  INCOME_TYPE_LABELS,
  LIABILITY_TYPE_LABELS,
  MARITAL_STATUS_LABELS,
} from './labels';
import {
  directorshipLine,
  dualCitizenshipLine,
  materialChangeLine,
  membershipLine,
  pendingCaseLine,
} from './other';
import {
  relationship,
  STATEMENTS_TITLE,
  STEP_TITLES,
  statementTitle,
  stepLink,
  type Step,
} from './steps';
import {
  type AnyItem,
  blockingGroups,
  blockingTitle,
  childDetails,
  childrenEmptyText,
  itemAmount,
  itemFlags,
  NOT_ANSWERED,
  type ParagraphCompleteness,
  paragraphCompleteness,
  readSummaryDocument,
  type SummaryDocument,
  spouseDetails,
  spousesEmptyText,
  statementTotals,
  submitNote,
  todayInKenya,
} from './summary';
import { useWorkspace } from './workspace';

type Sections = DeclarationSection[];

function EditLink({
  declarationId,
  step,
  name,
}: {
  declarationId: string;
  step: Step;
  name: string;
}) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link {...stepLink(declarationId, step)} aria-label={`Edit ${name}`}>
        <Icon icon={PencilEdit02Icon} />
        Edit
      </Link>
    </Button>
  );
}

function ErrorsLink({
  declarationId,
  step,
  children,
}: {
  declarationId: string;
  step: Step;
  children: ReactNode;
}) {
  // Every section route reads `?errors=true` to show all its missing answers at once.
  const search = { errors: true } as never;
  return (
    <Link
      {...stepLink(declarationId, step)}
      search={search}
      className="rounded-sm underline decoration-input underline-offset-3 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </Link>
  );
}

function BlockingPanel({ summary, sections }: { summary: LoadedSummary; sections: Sections }) {
  const headingId = useId();
  const { groups, hidden } = blockingGroups(summary.blocking, sections);
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-3 rounded-xl border border-warning/40 bg-warning-subtle p-5"
    >
      <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
        <Icon icon={Alert02Icon} className="size-5 text-warning" />
        {blockingTitle(summary.blocking.length)}
      </h2>
      <ul className="grid gap-3">
        {groups.map((group) => (
          <li key={group.key} className="grid gap-1">
            <h3 className="text-sm font-semibold">{group.label}</h3>
            <ul className="grid gap-1 pl-4 text-sm">
              {group.issues.map((issue) => (
                <li key={`${issue.path}-${issue.code}-${issue.message}`} className="list-disc">
                  <ErrorsLink declarationId={summary.declaration.id} step={group.key}>
                    {issue.message}
                  </ErrorsLink>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {hidden > 0 ? <p className="text-sm text-muted-foreground">and {hidden} more</p> : null}
    </section>
  );
}

function ParagraphCard({
  paragraphs,
  title,
  completeness,
  edit,
  children,
}: {
  paragraphs: string;
  title: string;
  completeness: ParagraphCompleteness;
  edit?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <Card className="p-0">
      <section aria-labelledby={headingId} className="grid gap-4 p-5">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="grid flex-1 gap-0.5">
            <p className="text-[12.5px] font-medium tracking-wide text-muted-foreground uppercase">
              {paragraphs}
            </p>
            <h2 id={headingId} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
          </div>
          <CompletenessBadge completeness={completeness} />
          {edit}
        </header>
        {children}
      </section>
    </Card>
  );
}

/** A two-column list of terms and values; missing values show as "-". */
function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map(([term, value]) => (
        <div
          key={term}
          className="grid gap-0.5 py-2.5 text-sm first:pt-0 last:pb-0 sm:grid-cols-[14rem_1fr] sm:gap-4"
        >
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Muted({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return (
    <p className={warning ? 'text-sm font-medium text-warning' : 'text-sm text-muted-foreground'}>
      {children}
    </p>
  );
}

function BioCard({ summary, document }: { summary: LoadedSummary; document: SummaryDocument }) {
  const officer = document.officer ?? {};
  const { declaration } = summary;
  const birth = [
    officer.birth?.date ? formatDate(officer.birth.date) : undefined,
    officer.birth?.place?.trim(),
  ].filter(Boolean);
  const change = officer.maritalStatusChange;
  const employment = officer.employment ?? {};
  const nature = employment.nature
    ? employment.nature === 'other'
      ? `Other: ${orUnanswered(employment.natureOther)}`
      : EMPLOYMENT_NATURE_LABELS[employment.nature]
    : UNANSWERED;
  return (
    <ParagraphCard
      paragraphs="Paragraphs 1-5"
      title={STEP_TITLES.bio}
      completeness={paragraphCompleteness(declaration.sections, 'bio')}
      edit={<EditLink declarationId={declaration.id} step="bio" name={STEP_TITLES.bio} />}
    >
      <Rows
        rows={[
          ['Name', orUnanswered(fullName(officer.name))],
          ['Date and place of birth', birth.length > 0 ? birth.join(', ') : UNANSWERED],
          [
            'Marital status',
            <>
              {officer.maritalStatus ? MARITAL_STATUS_LABELS[officer.maritalStatus] : UNANSWERED}
              {change?.changed ? (
                <span className="block text-[13px] font-normal text-muted-foreground">
                  Changed since last declaration: {orUnanswered(change.explanation)}
                </span>
              ) : null}
            </>,
          ],
          ['Postal address', orUnanswered(officer.address?.postal)],
          ['Physical address', orUnanswered(officer.address?.physical)],
          [
            'Employer and designation',
            `${orUnanswered(employment.employer)} · ${orUnanswered(employment.designation)}`,
          ],
          ['Nature of employment', nature],
          [
            'Responsible Commission',
            employment.personnelFileNumber ? (
              <>
                {declaration.commission.name} · personnel file number{' '}
                <span className="font-mono">{employment.personnelFileNumber}</span>
              </>
            ) : (
              declaration.commission.name
            ),
          ],
        ]}
      />
    </ParagraphCard>
  );
}

function SpousesCard({ summary, document }: { summary: LoadedSummary; document: SummaryDocument }) {
  const { declaration } = summary;
  const spouses = document.spouses?.items ?? [];
  return (
    <ParagraphCard
      paragraphs="Paragraph 6"
      title="Spouses"
      completeness={paragraphCompleteness(declaration.sections, 'household')}
      edit={<EditLink declarationId={declaration.id} step="household" name="Spouses" />}
    >
      {spouses.length === 0 ? (
        <Muted
          warning={
            spousesEmptyText(document.spouses, document.officer?.maritalStatus) === NOT_ANSWERED
          }
        >
          {spousesEmptyText(document.spouses, document.officer?.maritalStatus)}
        </Muted>
      ) : (
        <Rows
          rows={spouses.map((spouse, index) => [
            fullName(spouse.name) || `Spouse ${String(index + 1)}`,
            spouseDetails(spouse),
          ])}
        />
      )}
    </ParagraphCard>
  );
}

function ChildrenCard({
  summary,
  document,
}: {
  summary: LoadedSummary;
  document: SummaryDocument;
}) {
  const { declaration } = summary;
  const children = document.children?.items ?? [];
  return (
    <ParagraphCard
      paragraphs="Paragraph 7"
      title="Dependent children"
      completeness={paragraphCompleteness(declaration.sections, 'household')}
      edit={<EditLink declarationId={declaration.id} step="household" name="Dependent children" />}
    >
      {children.length === 0 ? (
        <Muted warning={childrenEmptyText(document.children) === NOT_ANSWERED}>
          {childrenEmptyText(document.children)}
        </Muted>
      ) : (
        <Rows
          rows={children.map((child, index) => [
            fullName(child.name) || `Child ${String(index + 1)}`,
            childDetails(child, declaration.statementDate),
          ])}
        />
      )}
    </ParagraphCard>
  );
}

const CATEGORIES = [
  { key: 'income', nil: 'incomeNil', amount: 'Amount' },
  { key: 'assets', nil: 'assetsNil', amount: 'Value' },
  { key: 'liabilities', nil: 'liabilitiesNil', amount: 'Outstanding' },
] as const;

function typeLabel(category: (typeof CATEGORIES)[number]['key'], type: string | undefined) {
  if (!type) return UNANSWERED;
  if (category === 'income') return INCOME_TYPE_LABELS[type as keyof typeof INCOME_TYPE_LABELS];
  if (category === 'assets') return ASSET_TYPE_LABELS[type as keyof typeof ASSET_TYPE_LABELS];
  return LIABILITY_TYPE_LABELS[type as keyof typeof LIABILITY_TYPE_LABELS];
}

function categoryHeading(
  category: (typeof CATEGORIES)[number]['key'],
  statement: Draft<Statement>,
  statementDate: string,
) {
  const asAt = formatDate(statement.statementDate ?? statementDate);
  if (category === 'income') {
    const period = statement.incomePeriod;
    return period?.from && period.to
      ? `Income, ${formatDate(period.from)} to ${formatDate(period.to)}`
      : 'Income';
  }
  return category === 'assets' ? `Assets as at ${asAt}` : `Liabilities as at ${asAt}`;
}

function StatementItems({
  statement,
  personTitle,
  statementDate,
}: {
  statement: Draft<Statement>;
  personTitle: string;
  statementDate: string;
}) {
  return (
    <div className="grid gap-4">
      {CATEGORIES.map((category) => {
        const heading = categoryHeading(category.key, statement, statementDate);
        const items: AnyItem[] = statement[category.key] ?? [];
        return (
          <div key={category.key} className="grid gap-2">
            <h4 className="text-sm font-semibold">{heading}</h4>
            {items.length === 0 ? (
              <Muted warning={statement[category.nil] !== true}>
                {statement[category.nil] === true ? 'Nothing to declare.' : NOT_ANSWERED}
              </Muted>
            ) : (
              <Table caption={`${personTitle}: ${heading}, KES`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead className="text-right">{category.amount}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => {
                    const flags = itemFlags(item);
                    const documents = (item.attachments ?? [])
                      .map((attachment) => attachment.fileName)
                      .filter(Boolean);
                    return (
                      <TableRow key={item.id ?? index}>
                        <TableCell>{typeLabel(category.key, item.type)}</TableCell>
                        <TableCell>
                          <span className="block">{orUnanswered(item.description)}</span>
                          {flags.length > 0 ? (
                            <span className="block text-[13px] text-muted-foreground">
                              {flags.join(' · ')}
                            </span>
                          ) : null}
                          {documents.length > 0 ? (
                            <span className="block text-[13px] text-muted-foreground">
                              Documents: {documents.join(', ')}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {itemAmount(item)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function statementKeyOf(statement: Draft<Statement>) {
  return `statement:${statement.personKey ?? 'officer'}`;
}

function StatementsCard({
  summary,
  document,
}: {
  summary: LoadedSummary;
  document: SummaryDocument;
}) {
  const { declaration } = summary;
  const statements = document.statements ?? [];
  const persons = statements.map((statement) => {
    const key = statementKeyOf(statement);
    const name = fullName(statement.personName);
    const you = key === 'statement:officer';
    return {
      key,
      statement,
      name: you ? 'You' : name || 'Unnamed person',
      short: you ? 'You' : (statement.personName?.firstName?.trim() ?? name) || 'Unnamed person',
      relation: you ? 'You' : relationship(key),
      totals: statementTotals(statement),
      completeness: (declaration.sections.find((section) => section.key === key)?.completeness ??
        'not-started') as ParagraphCompleteness,
    };
  });

  return (
    <ParagraphCard
      paragraphs="Paragraph 8"
      title={STATEMENTS_TITLE}
      completeness={paragraphCompleteness(declaration.sections, 'statements')}
    >
      <div className="grid gap-1.5">
        <Table caption="Totals per person, KES">
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead className="text-right">Income</TableHead>
              <TableHead className="text-right">Assets</TableHead>
              <TableHead className="text-right">Liabilities</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {persons.map((person) => (
              <TableRow key={person.key}>
                <TableHead scope="row">{person.short}</TableHead>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(person.totals.income)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(person.totals.assets)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(person.totals.liabilities)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-[13px] text-muted-foreground">
          KES, approximate. Joint assets at whole value.
        </p>
      </div>
      <div className="grid gap-3">
        {persons.map((person, index) => {
          const title = statementTitle(person.key, person.name);
          return (
            <details
              key={person.key}
              open={index === 0}
              className="group rounded-xl border border-border"
            >
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
                <h3 className="flex-1 font-semibold">
                  {person.name}
                  {person.relation && person.relation !== 'You' ? (
                    <span className="font-normal text-muted-foreground"> · {person.relation}</span>
                  ) : null}
                </h3>
                <CompletenessBadge completeness={person.completeness} />
              </summary>
              <div className="grid gap-4 border-t border-border px-4 py-4">
                <div className="flex justify-end">
                  <EditLink declarationId={declaration.id} step={person.key} name={title} />
                </div>
                <StatementItems
                  statement={person.statement}
                  personTitle={person.name}
                  statementDate={declaration.statementDate}
                />
              </div>
            </details>
          );
        })}
      </div>
    </ParagraphCard>
  );
}

function OtherCard({ summary, document }: { summary: LoadedSummary; document: SummaryDocument }) {
  const { declaration } = summary;
  const other = document.otherInformation ?? {};
  const interests = other.registrableInterests ?? {};
  const names = (personKey: string) => {
    if (personKey === 'officer') return 'You';
    const statement = document.statements?.find((entry) => entry.personKey === personKey);
    return fullName(statement?.personName) || 'Unnamed person';
  };
  const lines = (values: string[], empty: string): ReactNode =>
    values.length === 0 ? (
      <span className="font-normal text-muted-foreground">{empty}</span>
    ) : (
      <ul className="grid gap-1">
        {values.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    );
  const changes = other.materialChanges ?? [];

  return (
    <ParagraphCard
      paragraphs="Paragraph 9"
      title={STEP_TITLES.other}
      completeness={paragraphCompleteness(declaration.sections, 'other')}
      edit={<EditLink declarationId={declaration.id} step="other" name={STEP_TITLES.other} />}
    >
      <Rows
        rows={[
          [
            'Material changes',
            lines(
              changes.map((entry) => materialChangeLine(entry, names)),
              'None flagged.',
            ),
          ],
          ['Directorships', lines((interests.directorships ?? []).map(directorshipLine), 'None.')],
          ['Memberships', lines((interests.memberships ?? []).map(membershipLine), 'None.')],
          ['Dual citizenship', dualCitizenshipLine(interests.dualCitizenship)],
          ['Pending cases', lines((interests.pendingCases ?? []).map(pendingCaseLine), 'None.')],
          [
            'Anything else',
            other.freeText?.trim() ? (
              <span className="whitespace-pre-line">{other.freeText.trim()}</span>
            ) : (
              <span className="font-normal text-muted-foreground">Nothing added.</span>
            ),
          ],
        ]}
      />
    </ParagraphCard>
  );
}

/** Re-reads the summary once saves still in flight on arrival have landed. */
function useFreshSummary(loaded: LoadedSummary): LoadedSummary {
  const { autosave, declaration } = useWorkspace();
  const [summary, setSummary] = useState(loaded);
  const [seen, setSeen] = useState(loaded);
  if (seen !== loaded) {
    setSeen(loaded);
    setSummary(loaded);
  }
  const busy = isSaving(autosave);
  const waited = useRef(busy);
  useEffect(() => {
    if (busy) {
      waited.current = true;
      return;
    }
    if (!waited.current) return;
    waited.current = false;
    void getDeclarationSummary({ data: { declarationId: declaration.id } }).then((result) => {
      if (result.status === 'ok') setSummary(result.summary);
    });
  }, [busy, declaration.id]);
  return summary;
}

export interface SummaryViewProps {
  summary: LoadedSummary;
  /** Today as an ISO date; defaults to today in Kenya. */
  today?: string;
}

/**
 * The summary (FE-8): what blocks submission with links to fix it, one card per paragraph of
 * the First Schedule with its completeness and an Edit link, the solemn declaration, and
 * Submit, which stays disabled in spec 05 with the reason (S20).
 */
export function SummaryView({ summary: loaded, today }: SummaryViewProps) {
  const summary = useFreshSummary(loaded);
  const navigate = useNavigate();
  const { declaration } = summary;
  const document = readSummaryDocument(summary.document);
  const noteId = useId();
  const solemnId = useId();
  const isDraft = declaration.status === 'draft';

  return (
    <div className="grid gap-6">
      {summary.blocking.length > 0 ? (
        <BlockingPanel summary={summary} sections={declaration.sections} />
      ) : (
        <Alert variant="success">
          <Icon icon={Tick02Icon} />
          <AlertDescription>
            <strong>Everything is complete.</strong> Check it, then submit.
          </AlertDescription>
        </Alert>
      )}

      <BioCard summary={summary} document={document} />
      <SpousesCard summary={summary} document={document} />
      <ChildrenCard summary={summary} document={document} />
      <StatementsCard summary={summary} document={document} />
      <OtherCard summary={summary} document={document} />

      <section aria-labelledby={solemnId} className="grid gap-2 rounded-xl bg-muted p-5">
        <h2 id={solemnId} className="text-base font-semibold">
          Solemn declaration
        </h2>
        <blockquote className="border-l-2 border-border pl-4 text-[15px]">
          "{summary.attestationText}"
        </blockquote>
        <p className="text-sm text-muted-foreground">
          You affirm this when you submit. No signature or witness needed.
        </p>
      </section>

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="grid flex-1 gap-0.5">
          <p className="font-semibold">Submit your declaration</p>
          <p id={noteId} className="text-sm text-muted-foreground">
            {submitNote(summary, today ?? todayInKenya())}
          </p>
        </div>
        <Button type="button" disabled aria-describedby={noteId}>
          <Icon icon={SentIcon} />
          Submit declaration
        </Button>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {isDraft ? (
          <DiscardDraftButton
            declarationId={declaration.id}
            onDiscarded={() => navigate({ to: '/', search: { discarded: true } })}
          />
        ) : (
          <span />
        )}
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Icon icon={CloudSavingDone01Icon} className="size-4" />
          Last saved {formatDateTime(declaration.updatedAt)}
        </p>
      </div>
    </div>
  );
}
