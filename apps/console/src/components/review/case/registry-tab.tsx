import type { DeclarationV1 } from '@adili/forms';
import {
  Alert,
  AlertDescription,
  Avatar,
  type AvatarTone,
  Badge,
  Button,
  cn,
  EmptyState,
  Icon,
  type IconProps,
  MatchTable,
  type MatchTableRow,
  Skeleton,
  Spinner,
  SystemStatusList,
  SystemStatusRow,
} from '@adili/ui';
import {
  Alert02Icon,
  BankIcon,
  Briefcase01Icon,
  Car01Icon,
  Clock01Icon,
  InformationCircleIcon,
  Location01Icon,
  Shield01Icon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import { useState } from 'react';

import { CASE_COPY, REGISTRY_COPY } from '../../../review-case/messages';
import {
  kraLines,
  matchRows,
  type RegistryLayout,
  type RegistryPerson,
  type SystemRow,
} from '../../../review-case/registry';
import type { RegistrySystem } from '../../../server/review/types';
import { FlagCard, type FlagActions } from './flags-tab';

const copy = REGISTRY_COPY;

const SYSTEM_ICONS: Record<RegistrySystem, IconProps['icon']> = {
  kra: BankIcon,
  ntsa: Car01Icon,
  brs: Briefcase01Icon,
  ardhisasa: Location01Icon,
};

const TONES: Record<RegistryPerson['kind'], AvatarTone> = {
  officer: 'brand',
  spouse: 'info',
  child: 'success',
};

const BADGE_TONES = { success: 'success', warning: 'warning', default: 'default' } as const;

interface FlagContext extends FlagActions {
  document: DeclarationV1 | null;
  previousVersion: number | null;
  currentVersion: number;
  canReview: boolean;
  editing: string | null;
}

function KraTable({ row }: { row: SystemRow }) {
  const rows: MatchTableRow[] = kraLines(row.rows).map((line) => ({
    id: line.id,
    record: line.label,
    declared: line.badge ? (
      <Badge variant={BADGE_TONES[line.badge.tone]}>{line.badge.text}</Badge>
    ) : (
      <span className={cn(line.warning ? 'font-semibold text-warning' : 'font-normal')}>
        {line.text}
      </span>
    ),
    declaredDetail: line.badge ? line.text : null,
  }));
  return (
    <MatchTable
      system={row.name}
      rows={rows}
      // The labels are short: keep each on one line and give the comparison the rest.
      className="[&_th[scope=row]]:w-px [&_th[scope=row]]:whitespace-nowrap"
      messages={{
        recordColumn: () => copy.kra.recordColumn,
        declaredColumn: copy.kra.declaredColumn,
        caption: () => copy.kra.caption,
      }}
    />
  );
}

function RecordsTable({
  row,
  document,
  onGoToItem,
}: {
  row: SystemRow & { system: Exclude<RegistrySystem, 'kra'> };
  document: DeclarationV1 | null;
  onGoToItem: (itemId: string) => void;
}) {
  const employer = (document?.officer.employment.employer.trim() ?? '') || null;
  const rows: MatchTableRow[] = matchRows(row.system, row.rows, document, row.flags).map(
    (match) => ({
      id: match.id,
      record: match.record,
      recordDetail: match.recordDetail,
      recordNote: match.supplier ? (
        <Badge variant="destructive">
          <Icon icon={Alert02Icon} strokeWidth={2.2} />
          {copy.table.supplier(employer)}
        </Badge>
      ) : null,
      relation: match.relation,
      declared: match.declared,
      declaredDetail: match.declaredDetail,
      action: match.itemId ? (
        <Button
          variant="link"
          className="h-auto px-0 text-xs font-medium"
          onClick={() => {
            if (match.itemId) onGoToItem(match.itemId);
          }}
        >
          {copy.table.goToItem}
        </Button>
      ) : null,
    }),
  );
  return <MatchTable system={row.name} rows={rows} />;
}

function SystemDetail({
  row,
  flags,
  onGoToItem,
}: {
  row: SystemRow;
  flags: FlagContext;
  onGoToItem: (itemId: string) => void;
}) {
  const { editing, ...context } = flags;
  return (
    <>
      {row.system === 'kra' ? (
        <KraTable row={row} />
      ) : (
        <RecordsTable
          row={{ ...row, system: row.system }}
          document={flags.document}
          onGoToItem={onGoToItem}
        />
      )}
      {row.flags.length > 0 ? (
        <ul aria-label={copy.flagsLabel(row.name)} className="grid gap-2.5">
          {row.flags.map((flag) => (
            <FlagCard
              key={flag.id}
              flag={flag}
              editing={editing === flag.id}
              pulse={false}
              showSystem={false}
              {...context}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function PersonChecks({
  person,
  checking,
  expanded,
  onExpand,
  flags,
  onGoToItem,
}: {
  person: RegistryPerson;
  checking: boolean;
  expanded: Record<string, boolean>;
  onExpand: (key: string, open: boolean) => void;
  flags: FlagContext;
  onGoToItem: (itemId: string) => void;
}) {
  const firstName = person.name.split(' ')[0] ?? person.name;
  return (
    <SystemStatusList
      label={copy.personLabel(person.name)}
      header={
        <>
          <Avatar name={person.name} tone={TONES[person.kind]} className="size-7 text-[11.5px]" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{person.name}</h3>
            <div className="text-[12.5px] text-muted-foreground">{copy.relation[person.kind]}</div>
          </div>
        </>
      }
    >
      {person.hasNationalId ? (
        person.systems.map((row) => (
          <SystemStatusRow
            key={row.key}
            name={row.name}
            icon={SYSTEM_ICONS[row.system]}
            status={row.status}
            description={row.description}
            checkedAt={row.checkedAt ?? undefined}
            checking={checking}
            expanded={expanded[row.key] ?? false}
            onExpandedChange={(open) => {
              onExpand(row.key, open);
            }}
          >
            {row.expandable ? (
              <SystemDetail row={row} flags={flags} onGoToItem={onGoToItem} />
            ) : null}
          </SystemStatusRow>
        ))
      ) : (
        <SystemStatusRow
          name={copy.noIdTitle}
          icon={Shield01Icon}
          description={copy.noIdBody(firstName)}
        />
      )}
    </SystemStatusList>
  );
}

function LoadingRows() {
  return (
    <div
      role="status"
      aria-label={copy.loading}
      className="overflow-hidden rounded-item bg-card shadow-card"
    >
      <div className="flex items-center gap-2.5 border-b bg-background/60 px-3.5 py-[11px]">
        <Skeleton className="size-7 rounded-full" />
        <div className="grid flex-1 gap-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="flex items-center gap-2.5 border-t border-border/60 px-3.5 py-3 first-of-type:border-t-0"
        >
          <Skeleton className="size-[30px] rounded-md" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
          <Skeleton className="h-[22px] w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export interface RegistryTabProps extends FlagContext {
  /** Null until the registry is read the first time. */
  layout: RegistryLayout | null;
  /** The registry records could not be read: the layout has the last check's statuses only. */
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  /** A re-check is running: every row says "Checking…". */
  checking: boolean;
  /** Review refused a re-check for its cooldown: the words to show. */
  cooldown: string | null;
  onGoToItem: (itemId: string) => void;
}

/**
 * The Registry tab (spec 07b FE-2): what the registry checks are, when they last ran, then per
 * person (the declarant first, then the household) a status row per registry. A registry that
 * answered opens to its records beside the declared items (a `MatchTable`; for KRA, the PIN,
 * compliance and income difference) and its indicators, which the officer holding the case marks
 * reviewed here as on the Flags tab. Someone without a national ID gets one row saying they were
 * not checked. When the records cannot be read, the statuses of the last check still show.
 */
export function RegistryTab({
  layout,
  failed,
  retrying,
  onRetry,
  checking,
  cooldown,
  onGoToItem,
  ...flags
}: RegistryTabProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className="grid gap-3.5">
      <Alert variant="info" role="note" className="font-medium">
        <Icon icon={InformationCircleIcon} />
        <AlertDescription>{copy.header}</AlertDescription>
      </Alert>
      {layout ? (
        <p className="text-[13px] text-muted-foreground">
          {layout.checkedAt ? copy.lastChecked(layout.checkedAt) : copy.notCheckedYet}
        </p>
      ) : null}
      {cooldown ? (
        <Alert variant="warning">
          <Icon icon={Clock01Icon} />
          <AlertDescription>{cooldown}</AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="warning">
          <Icon icon={WifiDisconnected01Icon} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <AlertDescription className="min-w-0 flex-1">{copy.loadFailed}</AlertDescription>
            <Button variant="secondary" size="xs" disabled={retrying} onClick={onRetry}>
              {retrying ? <Spinner /> : null}
              {CASE_COPY.retry}
            </Button>
          </div>
        </Alert>
      ) : null}
      {!layout ? (
        <LoadingRows />
      ) : layout.noIds ? (
        <EmptyState
          icon={<Icon icon={Shield01Icon} />}
          title={copy.emptyTitle}
          description={copy.emptyBody}
        />
      ) : (
        layout.persons.map((person) => (
          <PersonChecks
            key={person.personKey}
            person={person}
            checking={checking}
            expanded={expanded}
            onExpand={(key, open) => {
              setExpanded((all) => ({ ...all, [key]: open }));
            }}
            flags={flags}
            onGoToItem={onGoToItem}
          />
        ))
      )}
    </div>
  );
}
