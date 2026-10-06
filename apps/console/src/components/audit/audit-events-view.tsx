import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatDateTime,
  Icon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import { FileSearchIcon, FilterIcon } from '@hugeicons/core-free-icons';
import { type ReactNode, useState } from 'react';

import type { AuditEventPage, AuditEventSummary } from '../../server/audit/types';
import type { AuditEventView } from '../../server/audit-trail.server';
import type { ServiceResult } from '../../server/service-call';
import { LoadError } from '../load-error';
import { AuditEventDrawer } from './audit-event-drawer';
import { AuditFilters, type AuditFilterValues } from './audit-filters';
import { KindBadge, meaningfulRoles, ShortId } from './kind-badge';
import { messages as t } from './messages';

export interface AuditEventsViewProps {
  /** The page for the filters; null while it loads. */
  result: ServiceResult<AuditEventPage> | null;
  filters: AuditFilterValues;
  onFiltersChange: (filters: AuditFilterValues) => void;
  /** Whether this is the first page (an empty later page is not "no events"). */
  firstPage: boolean;
  /** Previous and Next, under the rows. */
  pager?: ReactNode;
  /** Loads an event in full for the drawer; tests may stub it. */
  loadEvent?: (eventId: string) => Promise<ServiceResult<AuditEventView>>;
  /** Names the person an event is about, for the drawer; tests may stub it. */
  loadPersonName?: (personId: string) => Promise<ServiceResult<string>>;
}

/**
 * The audit trail's events, newest first (ADR-008): when, what, who, about what or whom, in
 * which tenant's chain and on which legal basis. A row opens the event in full.
 */
export function AuditEventsView({
  result,
  filters,
  onFiltersChange,
  firstPage,
  pager,
  loadEvent,
  loadPersonName,
}: AuditEventsViewProps) {
  const [opened, setOpened] = useState<AuditEventSummary | null>(null);
  const items = result?.ok ? result.data.items : [];
  const filtered = Object.values(filters).some((value) => value !== undefined);
  return (
    <>
      <Card className="overflow-hidden p-0 sm:p-0">
        <AuditFilters applied={filters} onApply={onFiltersChange} />
        {result === null ? (
          <ListSkeleton />
        ) : !result.ok ? (
          <div className="p-5">
            <LoadError
              title={t.list.loadFailed.title}
              detail={t.list.loadFailed.body}
              retryLabel={t.list.loadFailed.retry}
            />
          </div>
        ) : items.length === 0 && firstPage ? (
          filtered ? (
            <EmptyState
              icon={<Icon icon={FilterIcon} />}
              title={t.list.noMatchesTitle}
              description={t.list.noMatchesBody}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onFiltersChange({});
                  }}
                >
                  {t.filters.clear}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Icon icon={FileSearchIcon} />}
              title={t.list.emptyTitle}
              description={t.list.emptyBody}
            />
          )
        ) : (
          <>
            <Table caption={t.list.caption} className="[&_caption]:sr-only">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.list.when}</TableHead>
                  <TableHead>{t.list.action}</TableHead>
                  <TableHead>{t.list.actor}</TableHead>
                  <TableHead>{t.list.resource}</TableHead>
                  <TableHead>{t.list.tenant}</TableHead>
                  <TableHead>{t.list.basis}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((event) => (
                  <TableRow
                    key={event.eventId}
                    className="cursor-pointer"
                    onClick={() => {
                      setOpened(event);
                    }}
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatDateTime(event.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <button
                          type="button"
                          className="text-left font-mono text-[13px] font-medium hover:underline"
                          onClick={(click) => {
                            click.stopPropagation();
                            setOpened(event);
                          }}
                        >
                          {event.action}
                        </button>
                        <KindBadge kind={event.kind} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-[13.5px]">
                        <ActorName actor={event.actor} kind={event.kind} />
                      </div>
                      <div className="text-[12.5px] text-muted-foreground">
                        {meaningfulRoles(event.actor.roles).join(', ') ||
                          t.actorTypes[event.actor.type]}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-[13.5px]">{event.resource.type}</div>
                      {event.resource.subjectPersonId ? (
                        <div className="text-[12.5px] text-muted-foreground">
                          {t.list.person} <ShortId value={event.resource.subjectPersonId} />
                        </div>
                      ) : event.resource.id ? (
                        <div className="text-[12.5px] text-muted-foreground">
                          <ShortId value={event.resource.id} />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge size="tag">{event.tenant}</Badge>
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {event.legalBasis ? (
                        <>
                          <div>{event.legalBasis.basis}</div>
                          {event.legalBasis.reference ? (
                            <div className="text-[12.5px] text-muted-foreground">
                              <ShortId value={event.legalBasis.reference} />
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">{t.drawer.none}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pager}
          </>
        )}
      </Card>
      <AuditEventDrawer
        event={opened}
        onClose={() => {
          setOpened(null);
        }}
        {...(loadEvent ? { load: loadEvent } : {})}
        {...(loadPersonName ? { loadPersonName } : {})}
      />
    </>
  );
}

/** Who acted: a service by its name, an anonymous caller as such, a user by their id. */
function ActorName({
  actor,
  kind,
}: {
  actor: AuditEventSummary['actor'];
  kind: AuditEventSummary['kind'];
}) {
  if (actor.type === 'service') return <span>{actor.id.replace(/^adili\//, '')}</span>;
  if (actor.type === 'anonymous' && kind !== 'verification') return <span>{t.list.anonymous}</span>;
  return <ShortId value={actor.id} />;
}

function ListSkeleton() {
  return (
    <div className="space-y-3 p-5" aria-hidden="true">
      {Array.from({ length: 6 }, (_, at) => (
        <Skeleton key={at} className="h-10 w-full" />
      ))}
    </div>
  );
}
