import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogTrigger,
  EmptyState,
  FilterChip,
  formatDate,
  Icon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@adili/ui';
import { Search01Icon, UserAdd01Icon } from '@hugeicons/core-free-icons';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useId, useState } from 'react';

import type { Agency, LeaOfficerAccount } from '../../server/directory/client';
import { revokeLeaOfficer } from '../../server/lea-accounts';
import type { AgencyOfficers } from '../../server/lea-accounts.server';
import { formatPhone } from '../commissions/phone';
import { CursorPager } from '../cursor-pager';
import { Page } from '../page';
import { SearchBox } from '../search-box';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m, STATE_TONE } from './messages';
import {
  filterCounts,
  filterOfficers,
  OFFICER_FILTERS,
  type OfficerFilter,
  OFFICERS_PAGE_SIZE,
} from './officers';
import { ProvisionDialogContent } from './provision-dialog';
import { RevokeDialog } from './revoke-dialog';

/**
 * An agency's officer accounts (spec 10 FE-6, S11): every officer ever provisioned for it, with
 * search and a filter by account state; the platform administrator provisions another (one
 * activation email) and revokes an account, which disables it at once.
 */
export function AgencyOfficersPage({ data }: { data: AgencyOfficers }) {
  const { agency, officers, agencies } = data;
  const id = useId();
  const router = useRouter();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [filter, setFilter] = useState<OfficerFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [provisioning, setProvisioning] = useState(false);
  const [revoking, setRevoking] = useState<LeaOfficerAccount | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const counts = filterCounts(officers);
  const rows = filterOfficers(officers, filter, search);
  const pages = Math.max(1, Math.ceil(rows.length / OFFICERS_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * OFFICERS_PAGE_SIZE, (current + 1) * OFFICERS_PAGE_SIZE);

  const provision = (
    <Dialog open={provisioning} onOpenChange={setProvisioning}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Icon icon={UserAdd01Icon} />
          {m.provision}
        </Button>
      </DialogTrigger>
      {provisioning ? (
        <ProvisionDialogContent
          agencies={agencies}
          agencyCode={agency.code}
          onProvisioned={(officer) => {
            setProvisioning(false);
            toast({ title: m.provisioned(officer.name) });
            if (officer.agencyCode !== agency.code) {
              void navigate({
                to: '/platform/law-enforcement/$agencyCode',
                params: { agencyCode: officer.agencyCode },
              });
              return;
            }
            setFilter('all');
            setSearch('');
            void router.invalidate();
          }}
        />
      ) : null}
    </Dialog>
  );

  const revoke = async () => {
    if (!revoking) return;
    setRevokeBusy(true);
    setRevokeError(null);
    const result = await revokeLeaOfficer({ data: { officerId: revoking.id } }).catch(() => null);
    setRevokeBusy(false);
    if (result?.ok) {
      toast({ title: m.revoked(revoking.name) });
      setRevoking(null);
      await router.invalidate();
      return;
    }
    if (result?.error.kind === 'unauthenticated') {
      goToSignIn();
      return;
    }
    const busy =
      result?.error.kind === 'problem' && result.error.problem.type === 'lea-officer-busy';
    setRevokeError(busy ? m.revokeBusy : m.revokeFailed);
  };

  return (
    <Page>
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="mb-1.5">
            <AgencyCode code={agency.code} />
          </div>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] min-[700px]:text-[26px]">
            {agency.name}
          </h1>
          <p className="mt-1 text-[14.5px] text-muted-foreground">{agency.legalBasis}</p>
        </div>
        {officers.length > 0 ? <div className="ml-auto">{provision}</div> : null}
      </div>

      <Card className="overflow-hidden p-0 sm:p-0">
        {officers.length === 0 ? (
          <EmptyState
            icon={<Icon icon={UserAdd01Icon} />}
            title={m.noOfficersTitle}
            description={m.noOfficersText(agency.code)}
            action={provision}
          />
        ) : (
          <>
            <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <SearchBox
                id={`${id}-search`}
                label={m.searchLabel}
                placeholder={m.searchPlaceholder}
                maxLength={200}
                applied={search}
                className="max-w-[360px] min-w-[240px]"
                onSearch={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
              />
              <div role="group" aria-label={m.filtersLabel} className="flex flex-wrap gap-1.5">
                {OFFICER_FILTERS.map((each) => (
                  <FilterChip
                    key={each}
                    pressed={filter === each}
                    count={counts[each]}
                    countLabel={m.officersLabel}
                    onPressedChange={() => {
                      setFilter(each);
                      setPage(0);
                    }}
                  >
                    {m.filters[each]}
                  </FilterChip>
                ))}
              </div>
            </div>
            {rows.length === 0 ? (
              <EmptyState
                icon={<Icon icon={Search01Icon} />}
                title={m.noMatchesTitle}
                description={m.noMatchesText}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setFilter('all');
                      setSearch('');
                    }}
                  >
                    {m.clearFilters}
                  </Button>
                }
              />
            ) : (
              <>
                <OfficersTable
                  agency={agency}
                  officers={shown}
                  onRevoke={(officer) => {
                    setRevokeError(null);
                    setRevoking(officer);
                  }}
                />
                {rows.length > OFFICERS_PAGE_SIZE ? (
                  <CursorPager
                    labels={{
                      pagination: m.pagination,
                      pageRange: m.pageRange,
                      pageRows: m.pageRows,
                      previousPage: m.previousPage,
                      nextPage: m.nextPage,
                    }}
                    range={{
                      from: current * OFFICERS_PAGE_SIZE + 1,
                      to: current * OFFICERS_PAGE_SIZE + shown.length,
                    }}
                    rows={shown.length}
                    hasPrevious={current > 0}
                    hasNext={current < pages - 1}
                    onPrevious={() => {
                      setPage(current - 1);
                    }}
                    onNext={() => {
                      setPage(current + 1);
                    }}
                  />
                ) : null}
              </>
            )}
          </>
        )}
      </Card>

      <RevokeDialog
        officer={revoking}
        busy={revokeBusy}
        error={revokeError}
        onOpenChange={(open) => {
          if (!open && !revokeBusy) setRevoking(null);
        }}
        onConfirm={() => void revoke()}
      />
    </Page>
  );
}

/** An agency's code in the kit's reference chip style. */
export function AgencyCode({ code }: { code: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-muted px-2 font-mono text-[12.5px] font-semibold tracking-[0.02em] text-secondary-foreground">
      {code}
    </span>
  );
}

function OfficersTable({
  agency,
  officers,
  onRevoke,
}: {
  agency: Agency;
  officers: LeaOfficerAccount[];
  onRevoke: (officer: LeaOfficerAccount) => void;
}) {
  return (
    <Table caption={m.officersCaption(agency.code)}>
      <TableHeader>
        <TableRow>
          <TableHead>{m.columnOfficer}</TableHead>
          <TableHead>{m.columnPhone}</TableHead>
          <TableHead>{m.columnStatus}</TableHead>
          <TableHead>{m.columnInvitedOn}</TableHead>
          <TableHead>{m.columnActivatedOn}</TableHead>
          <TableHead>
            <span className="sr-only">{m.columnActions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {officers.map((officer) => (
          <TableRow key={officer.id}>
            <TableHead scope="row" className="min-w-[200px] font-normal">
              <div className="font-medium text-foreground">{officer.name}</div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">{officer.email}</div>
            </TableHead>
            <TableCell className="text-[13.5px] whitespace-nowrap tabular-nums">
              {formatPhone(officer.phone)}
            </TableCell>
            <TableCell>
              <Badge variant={STATE_TONE[officer.state]}>{m.state[officer.state]}</Badge>
              {officer.state === 'revoked' && officer.revokedAt ? (
                <div className="mt-0.5 text-[13px] whitespace-nowrap text-muted-foreground">
                  {formatDate(officer.revokedAt)}
                </div>
              ) : null}
            </TableCell>
            <TableCell className="text-[13.5px] whitespace-nowrap">
              {formatDate(officer.invitedAt)}
            </TableCell>
            <TableCell className="text-[13.5px] whitespace-nowrap">
              {officer.activatedAt ? (
                formatDate(officer.activatedAt)
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              {officer.state !== 'revoked' ? (
                <Button
                  variant="destructive-ghost"
                  size="sm"
                  aria-label={m.revokeOfficer(officer.name)}
                  onClick={() => {
                    onRevoke(officer);
                  }}
                >
                  {m.revoke}
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
