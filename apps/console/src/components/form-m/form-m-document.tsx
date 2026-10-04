import type { FormMV1 } from '@adili/forms';
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  cn,
  FORM_M_DECLARATION_SECTIONS,
  FormMSection,
  type FormMSectionProps,
  formatDate,
  formatNumber,
  Icon,
  InfoTip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type Tone,
} from '@adili/ui';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useState } from 'react';

import { CursorPager } from '../cursor-pager';
import { clientPage } from '../paging';
import { messages as m } from './messages';

/**
 * Form M as the prescribed form lays it out (spec 09 FE-2): Part I, Part II sections 1-5, Part B
 * and Part III, read-only. Each part is its own component with an anchor id, so the sign-off
 * screens (#226) can swap Part I and Part B for their editable versions and give sections 1-3
 * editable remarks (`sectionProps`) without restating the rest.
 */

/** Rows to a page in the long lists (sections 1-4), as in the prototype. */
export const FORM_M_PAGE_SIZE = 10;

/** Anchor ids of the parts, for the Sections nav. */
export const FORM_M_ANCHORS = {
  partI: 'form-m-part-i',
  initial: 'form-m-section-1',
  biennial: 'form-m-section-2',
  final: 'form-m-section-3',
  clarifications: 'form-m-section-4',
  access: 'form-m-section-5',
  complaints: 'form-m-part-b',
  partIII: 'form-m-part-iii',
} as const;

/** A card of the form (the kit's `.card` with `.sec-h` and `.sec-b`), labelled by its heading. */
export function PartCard({
  id,
  title,
  actions,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <Card asChild className={cn('scroll-mt-20 gap-0 overflow-hidden p-0 sm:p-0', className)}>
      <section id={id} aria-labelledby={headingId}>
        <div className="flex flex-wrap items-center gap-2.5 border-b px-5 py-4">
          <h3 id={headingId} className="text-[15.5px] font-semibold tracking-[-0.01em]">
            {title}
          </h3>
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </section>
    </Card>
  );
}

/** A numbered section card (sections 4 and 5), headed like `FormMSection`. */
function NumberedSection({
  id,
  number,
  title,
  tip,
  children,
}: {
  id: string;
  number: number;
  title: string;
  tip: string;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <Card asChild className="@container scroll-mt-20 gap-0 overflow-hidden p-0 sm:p-0">
      <section id={id} aria-labelledby={headingId}>
        <div className="flex items-start gap-3 px-5 pt-[18px] pb-3.5">
          <span
            aria-hidden="true"
            className="grid size-7 flex-none place-items-center rounded-lg bg-muted text-[13.5px] font-semibold"
          >
            {number}
          </span>
          <h3
            id={headingId}
            className="min-w-0 pt-0.5 text-[15.5px] leading-[1.35] font-semibold tracking-[-0.01em]"
          >
            {title}
            <InfoTip label={m.aboutSection(number)} content={tip} className="ml-1" />
          </h3>
        </div>
        {children}
      </section>
    </Card>
  );
}

/** A static callout (no live role: it is not news). */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Alert role={undefined} className={cn('w-auto', className)}>
      <Icon icon={InformationCircleIcon} />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** "Not filled yet" for a blank field, else its value. */
function Filled({ value, empty = m.notFilled }: { value: string; empty?: string }) {
  return value.trim() ? (
    <>{value}</>
  ) : (
    <span className="font-normal text-muted-foreground">{empty}</span>
  );
}

export function Field({
  roman,
  label,
  children,
}: {
  roman: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-[12.5px] font-medium text-muted-foreground">
        {roman} {label}
      </dt>
      <dd className="mt-0.5 text-[14.5px] font-medium break-words">{children}</dd>
    </div>
  );
}

/** Part I: the Commission, its contact details and the period, as the draft holds them. */
export function PartICard({ partI }: { partI: FormMV1['partI'] }) {
  return (
    <PartCard id={FORM_M_ANCHORS.partI} title={m.partI}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 px-5 py-[18px] sm:grid-cols-2">
        <Field roman="(i)" label={m.partINames.commissionName}>
          {partI.commissionName}
        </Field>
        <Field roman="(ii)" label={m.partINames.contactDetails}>
          <Filled value={partI.contactDetails} />
        </Field>
        <Field roman="(iii)" label={m.partINames.physicalAddress}>
          <Filled value={partI.physicalAddress} />
        </Field>
        <Field roman="(iv)" label={m.partINames.emailAddress}>
          <Filled value={partI.emailAddress} />
        </Field>
        <Field roman="(v)" label={m.partINames.period}>
          {m.period(partI.period.financialYearStart)}
        </Field>
      </dl>
    </PartCard>
  );
}

/** The heading over Part II's sections. */
export function PartHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5 px-0.5 pt-1.5">
      <h2 className="text-[13px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {children}
      </h2>
      <span aria-hidden="true" className="h-px flex-1 self-center bg-border" />
    </div>
  );
}

const pagerLabels = (total: number) => ({
  pagination: m.pagination,
  pageRange: (from: number, to: number) => m.pageRange(from, to, formatNumber(total)),
  pageRows: m.pageRows,
  previousPage: m.previousPage,
  nextPage: m.nextPage,
});

/** A pager under a long list, or nothing for a list that fits on one page. */
function ListPager({
  total,
  page,
  onPage,
}: {
  total: number;
  page: ReturnType<typeof clientPage>;
  onPage: (page: number) => void;
}) {
  if (page.pages <= 1) return null;
  return (
    <CursorPager
      labels={pagerLabels(total)}
      range={{ from: page.from, to: page.to }}
      rows={page.rows.length}
      hasPrevious={page.page > 1}
      hasNext={page.page < page.pages}
      onPrevious={() => {
        onPage(page.page - 1);
      }}
      onNext={() => {
        onPage(page.page + 1);
      }}
    />
  );
}

/** One of sections 1-3, its list of officers paged ten at a time. */
function DeclarationSection({
  section,
  data,
  props,
}: {
  section: (typeof FORM_M_DECLARATION_SECTIONS)[number];
  data: FormMV1['partII']['biennial'];
  props?: Partial<FormMSectionProps>;
}) {
  const [requested, setRequested] = useState(1);
  const page = clientPage(data.nonFilers, requested, FORM_M_PAGE_SIZE);
  return (
    <FormMSection
      id={FORM_M_ANCHORS[section]}
      className="scroll-mt-20"
      section={section}
      data={{ ...data, nonFilers: page.rows }}
      nonFilersTotal={data.nonFilers.length}
      firstRowNumber={page.from}
      pagination={<ListPager total={data.nonFilers.length} page={page} onPage={setRequested} />}
      {...props}
    />
  );
}

/** Part II sections 1-3 (`FormMSection`), with any props the caller adds per section. */
export function DeclarationSections({
  partII,
  sectionProps,
}: {
  partII: FormMV1['partII'];
  /** E.g. editable remarks for the supervisor (#226). */
  sectionProps?: (
    section: (typeof FORM_M_DECLARATION_SECTIONS)[number],
  ) => Partial<FormMSectionProps>;
}) {
  return (
    <>
      {FORM_M_DECLARATION_SECTIONS.map((section) => (
        <DeclarationSection
          key={section}
          section={section}
          data={partII[section]}
          props={sectionProps?.(section)}
        />
      ))}
    </>
  );
}

type ClarificationStatus =
  FormMV1['partII']['clarifications']['items'][number]['statusOfCompliance'];

const CLARIFICATION_TONES: Record<ClarificationStatus, Tone> = {
  resolved: 'success',
  responded: 'info',
  pending: 'default',
  overdue: 'destructive',
  withdrawn: 'default',
};

/** Section 4: the clarifications sought, their nature in general terms and how they stand. */
export function ClarificationsSection({
  clarifications,
}: {
  clarifications: FormMV1['partII']['clarifications'];
}) {
  const [requested, setRequested] = useState(1);
  const { items } = clarifications;
  const page = clientPage(items, requested, FORM_M_PAGE_SIZE);
  return (
    <NumberedSection
      id={FORM_M_ANCHORS.clarifications}
      number={4}
      title={m.clarificationsTitle}
      tip={m.clarificationsTip}
    >
      {items.length > 0 ? (
        <div className="border-t pb-1.5">
          <Table caption={m.clarificationsCaption} showCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{m.number}</TableHead>
                <TableHead>{m.name}</TableHead>
                <TableHead>{m.designation}</TableHead>
                <TableHead>{m.nature}</TableHead>
                <TableHead>{m.statusOfCompliance}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((item, index) => (
                <TableRow
                  key={item.clarificationReference ?? `${item.identifier}-${String(index)}`}
                >
                  <TableCell className="w-9 align-top text-muted-foreground tabular-nums">
                    {`${String(page.from + index)}.`}
                  </TableCell>
                  <TableCell className="min-w-[170px] align-top">
                    <div className="font-medium">{item.name}</div>
                    <div className="font-mono text-[12.5px] text-muted-foreground">
                      {item.identifier}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[140px] align-top">{item.designation}</TableCell>
                  <TableCell className="min-w-[200px] align-top">
                    {item.natureInGeneralTerms}
                    {item.clarificationReference ? (
                      <div className="font-mono text-[12.5px] text-muted-foreground">
                        {item.clarificationReference}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant={CLARIFICATION_TONES[item.statusOfCompliance]}>
                      {m.clarificationStatus[item.statusOfCompliance]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPager total={items.length} page={page} onPage={setRequested} />
        </div>
      ) : (
        <Note className="mx-5 mb-5">{m.noClarifications}</Note>
      )}
    </NumberedSection>
  );
}

/** Three counts (a) to (c) in a strip, stacked below 700px of container width. */
function Counts({ counts }: { counts: readonly (readonly [string, string, number])[] }) {
  return (
    <dl className="mx-5 grid grid-cols-1 overflow-hidden rounded-xl shadow-card-flat @min-[700px]:grid-cols-3">
      {counts.map(([letter, label, count]) => (
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
  );
}

/**
 * Section 5: access requests received, granted and declined, and why declined; zeros with a note
 * while the platform holds no access request data for the year.
 */
export function AccessSection({
  accessRequests,
  dataUnavailable,
}: {
  accessRequests: FormMV1['partII']['accessRequests'];
  /** The report's `accessDataUnavailable`. */
  dataUnavailable: boolean;
}) {
  const reasons = accessRequests.declineReasons.filter((reason) => reason.count > 0);
  return (
    <NumberedSection id={FORM_M_ANCHORS.access} number={5} title={m.accessTitle} tip={m.accessTip}>
      {dataUnavailable ? <Note className="mx-5 mb-3.5">{m.accessUnavailable}</Note> : null}
      <Counts
        counts={[
          ['(a)', m.accessReceived, accessRequests.received],
          ['(b)', m.accessGranted, accessRequests.granted],
          ['(c)', m.accessDeclined, accessRequests.declined],
        ]}
      />
      <div className="px-5 pt-3.5 pb-[18px] text-[13.5px]">
        <div className="font-medium text-secondary-foreground">
          <b className="font-semibold">(d)</b> {m.accessReasons}
        </div>
        {reasons.length > 0 ? (
          <ul className="mt-1 grid gap-0.5">
            {reasons.map((reason) => (
              <li key={reason.reason} className="flex gap-2">
                <span>{m.declineReasons[reason.reason]}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatNumber(reason.count)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-1 text-muted-foreground">{m.noneDeclined}</div>
        )}
      </div>
    </NumberedSection>
  );
}

/** Part B, sections 6-7: the complaints register and the complaints received, as entered. */
export function ComplaintsCard({ complaints }: { complaints: FormMV1['partII']['complaints'] }) {
  const register = complaints.registerMaintained;
  return (
    <PartCard id={FORM_M_ANCHORS.complaints} title={m.partB}>
      <div className="grid gap-4 px-5 py-[18px]">
        <div>
          <p className="text-[14.5px] font-medium">
            <span className="mr-1.5 text-[12.5px] text-muted-foreground">6.</span>
            {m.registerQuestion}
          </p>
          <p className="mt-2.5 text-[14.5px] font-medium">
            {register === null ? (
              <span className="font-normal text-muted-foreground">{m.notAnswered}</span>
            ) : register ? (
              m.yes
            ) : (
              m.no
            )}
          </p>
        </div>
        <p className="text-[14.5px] font-medium">
          <span className="mr-1.5 text-[12.5px] text-muted-foreground">7.</span>
          {m.complaintsCount}{' '}
          <span className="tabular-nums">{formatNumber(complaints.items.length)}</span>
        </p>
      </div>
      {complaints.items.length > 0 ? (
        <div className="border-t pb-1.5">
          <Table caption={m.complaintsCaption} showCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{m.number}</TableHead>
                <TableHead>{m.name}</TableHead>
                <TableHead>{m.designation}</TableHead>
                <TableHead>{m.complaintNature}</TableHead>
                <TableHead>{m.complaintStatus}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {complaints.items.map((item, index) => (
                <TableRow key={`${item.identifier}-${String(index)}`}>
                  <TableCell className="w-9 align-top text-muted-foreground tabular-nums">
                    {`${String(index + 1)}.`}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="font-medium">{item.name}</div>
                    <div className="font-mono text-[12.5px] text-muted-foreground">
                      {item.identifier}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">{item.designation}</TableCell>
                  <TableCell className="align-top">{item.nature}</TableCell>
                  <TableCell className="align-top">{item.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Note className="mx-5 mb-5">{m.noComplaints}</Note>
      )}
    </PartCard>
  );
}

function SignatoryLine({
  label,
  value,
  pending,
}: {
  label: string;
  value: string | null;
  pending: string;
}) {
  return (
    <div className="flex gap-2.5 py-1 text-sm">
      <dt className="w-24 flex-none text-muted-foreground">{label}</dt>
      <dd className={cn(!value && 'text-muted-foreground', !value && pending !== '-' && 'italic')}>
        {value ?? pending}
      </dd>
    </div>
  );
}

function Signatory({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="rounded-xl bg-background/40 px-4 py-3.5 shadow-card-flat">
      <h4 id={id} className="mb-2 text-[13px] font-semibold text-secondary-foreground">
        {title}
      </h4>
      <dl aria-labelledby={id}>{children}</dl>
    </div>
  );
}

/** Part III: who compiled (filled on review) and who confirmed (filled on confirmation). */
export function PartIIICard({ partIII }: { partIII: FormMV1['partIII'] }) {
  const { compiledBy, confirmedBy } = partIII;
  return (
    <PartCard id={FORM_M_ANCHORS.partIII} title={m.partIII}>
      <div className="grid grid-cols-1 gap-3.5 px-5 py-[18px] sm:grid-cols-2">
        <Signatory title={m.compiledBy}>
          <SignatoryLine label={m.name} value={compiledBy.name} pending={m.onReview} />
          <SignatoryLine label={m.designation} value={compiledBy.designation} pending="-" />
          <SignatoryLine
            label={m.date}
            value={compiledBy.date && formatDate(compiledBy.date)}
            pending="-"
          />
        </Signatory>
        <Signatory title={m.confirmedBy}>
          <SignatoryLine label={m.name} value={confirmedBy.name} pending={m.onConfirmation} />
          <SignatoryLine
            label={m.date}
            value={confirmedBy.date && formatDate(confirmedBy.date)}
            pending="-"
          />
          <p className="mt-1.5 text-[13px] text-muted-foreground">{m.authorizedOfficer}</p>
        </Signatory>
      </div>
    </PartCard>
  );
}
