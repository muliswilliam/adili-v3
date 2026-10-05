import {
  Alert,
  AlertDescription,
  Badge,
  CopyButton,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  formatDateTime,
  Skeleton,
} from '@adili/ui';
import { useEffect, useEffectEvent, useState } from 'react';

import type { AuditEventSummary } from '../../server/audit/types';
import { getAuditEventDetail } from '../../server/audit-trail';
import type { AuditEventView } from '../../server/audit-trail.server';
import type { ServiceResult } from '../../server/service-call';
import { Fact } from '../referrals/fact';
import { KindBadge, meaningfulRoles, ShortId } from './kind-badge';
import { messages as t } from './messages';

/**
 * One event in full (ADR-008 event schema): when, who through which client and roles, what about
 * whom, on which basis, the request, the producing service, its place in the hash chain and its
 * data as published. Opening it is itself an audited read.
 */
export function AuditEventDrawer({
  event,
  onClose,
  load = (eventId) => getAuditEventDetail({ data: { eventId } }),
}: {
  /** The row opened; null when closed. */
  event: AuditEventSummary | null;
  onClose: () => void;
  /** Loads the event in full; tests may stub it. */
  load?: (eventId: string) => Promise<ServiceResult<AuditEventView>>;
}) {
  const detail = useEventDetail(event?.eventId ?? null, load);
  const full = detail?.ok ? detail.data : null;
  return (
    <Drawer
      open={event !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="sm:max-w-[560px]">
        {event ? (
          <>
            <DrawerHeader>
              <div className="mb-1.5">
                <KindBadge kind={event.kind} />
              </div>
              <DrawerTitle className="font-mono text-[17px] break-all">{event.action}</DrawerTitle>
              <DrawerDescription>{formatDateTime(event.occurredAt)}</DrawerDescription>
            </DrawerHeader>
            <DrawerBody className="space-y-6">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Fact term={t.drawer.actor}>
                  <span className="block">{t.actorTypes[event.actor.type]}</span>
                  <span className="block text-[13px] font-normal break-all">
                    <ShortId value={event.actor.id} keep={13} />
                  </span>
                  {event.actor.onBehalfOf ? (
                    <span className="block text-[13px] font-normal text-muted-foreground">
                      {t.list.onBehalfOf(event.actor.onBehalfOf)}
                    </span>
                  ) : null}
                </Fact>
                <Fact term={t.drawer.roles}>
                  {meaningfulRoles(event.actor.roles).length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {meaningfulRoles(event.actor.roles).map((role) => (
                        <Badge key={role}>{role}</Badge>
                      ))}
                    </span>
                  ) : (
                    t.drawer.none
                  )}
                </Fact>
                <Fact term={t.drawer.client}>{event.actor.clientId ?? t.drawer.none}</Fact>
                <Fact term={t.drawer.resource}>
                  <span className="block">{event.resource.type}</span>
                  {event.resource.id ? (
                    <span className="block text-[13px] font-normal break-all">
                      <ShortId value={event.resource.id} keep={13} />
                    </span>
                  ) : null}
                </Fact>
                <Fact term={t.drawer.person}>
                  {event.resource.subjectPersonId ? (
                    <ShortId value={event.resource.subjectPersonId} keep={13} />
                  ) : (
                    t.drawer.none
                  )}
                </Fact>
                <Fact term={t.drawer.basis}>
                  {event.legalBasis
                    ? `${event.legalBasis.basis}${event.legalBasis.reference ? ` · ${event.legalBasis.reference}` : ''}`
                    : t.drawer.none}
                </Fact>
                {event.recipient ? <Fact term={t.drawer.recipient}>{event.recipient}</Fact> : null}
                <Fact term={t.drawer.source}>{event.source}</Fact>
                <Fact term={t.drawer.eventType}>
                  <span className="font-mono text-[13px]">{event.eventType}</span>
                </Fact>
                <Fact term={t.drawer.recorded}>{formatDateTime(event.recordedAt)}</Fact>
                {full?.request ? (
                  <div className="sm:col-span-2">
                    <Fact term={t.drawer.request}>
                      <span className="font-mono text-[13px] break-all">
                        {`${full.request.method} ${full.request.route ?? ''}`}
                      </span>
                    </Fact>
                  </div>
                ) : null}
              </dl>

              {detail === null ? (
                <div aria-label={t.drawer.loading} className="space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : !full ? (
                <Alert variant="destructive">
                  <AlertDescription>{t.drawer.loadFailed}</AlertDescription>
                </Alert>
              ) : (
                <>
                  <section aria-labelledby="audit-chain-heading" className="rounded-lg border p-4">
                    <h3 id="audit-chain-heading" className="mb-3 text-[14px] font-semibold">
                      {t.drawer.chain}
                    </h3>
                    <p className="mb-3 text-[13.5px]">
                      {t.drawer.chainValue(event.tenant, full.chain.chainDay, full.chain.seq)}
                    </p>
                    <dl className="space-y-2.5 text-[13px]">
                      <HashLine term={t.drawer.hash} value={full.chain.hash} />
                      <HashLine term={t.drawer.prevHash} value={full.chain.prevHash} />
                    </dl>
                  </section>
                  <section aria-labelledby="audit-data-heading">
                    <h3 id="audit-data-heading" className="mb-2 text-[14px] font-semibold">
                      {t.drawer.data}
                    </h3>
                    <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all">
                      {full.dataJson}
                    </pre>
                  </section>
                </>
              )}
            </DrawerBody>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The event in full, loaded when the drawer opens on it: null while it loads. Kept per event id,
 * so another row never shows the previous row's detail.
 */
function useEventDetail(
  eventId: string | null,
  load: (eventId: string) => Promise<ServiceResult<AuditEventView>>,
): ServiceResult<AuditEventView> | null {
  const [loaded, setLoaded] = useState<{
    eventId: string;
    result: ServiceResult<AuditEventView>;
  } | null>(null);
  // The latest `load`, so a new function each render (a default argument) never refetches.
  const fetchDetail = useEffectEvent((id: string) =>
    load(id).catch(() => ({ ok: false, error: { kind: 'unavailable', detail: null } }) as const),
  );
  useEffect(() => {
    if (eventId === null) return;
    let live = true;
    void fetchDetail(eventId).then((result) => {
      if (live) setLoaded({ eventId, result });
    });
    return () => {
      live = false;
    };
  }, [eventId]);
  return loaded?.eventId === eventId ? loaded.result : null;
}

function HashLine({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{term}</dt>
      <dd className="min-w-0 flex-1 truncate font-mono" title={value}>
        {value}
      </dd>
      <CopyButton value={value} label={t.drawer.copyHash} size="sm" />
    </div>
  );
}
