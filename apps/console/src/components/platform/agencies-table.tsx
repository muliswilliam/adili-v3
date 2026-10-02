import {
  Card,
  EmptyState,
  Icon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from '@adili/ui';
import { Shield01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type { AgencyRow } from '../../server/lea-accounts.server';
import { AgencyCode } from './agency-officers';
import { messages as m } from './messages';

/**
 * The law enforcement agencies EACC issues officer accounts to (spec 10 FE-6), in display order,
 * with their officers counted by account state; each opens its officers.
 */
export function AgenciesTable({ agencies }: { agencies: AgencyRow[] }) {
  if (agencies.length === 0) {
    return (
      <Card className="p-0 sm:p-0">
        <EmptyState
          icon={<Icon icon={Shield01Icon} />}
          title={m.noAgenciesTitle}
          description={m.noAgenciesText}
        />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <Table caption={m.agenciesCaption}>
        <TableHeader>
          <TableRow>
            <TableHead>{m.columnAgency}</TableHead>
            <TableHead>{m.columnBasis}</TableHead>
            <TableHead className="text-right">{m.columnActive}</TableHead>
            <TableHead className="text-right">{m.columnInvited}</TableHead>
            <TableHead className="text-right">{m.columnRevoked}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agencies.map((agency) => (
            <TableRow key={agency.code}>
              <TableHead scope="row" className="min-w-[260px] font-normal">
                <div className="flex items-center gap-2.5">
                  <AgencyCode code={agency.code} />
                  <TableRowLink asChild className="font-medium">
                    <Link
                      to="/platform/law-enforcement/$agencyCode"
                      params={{ agencyCode: agency.code }}
                    >
                      {agency.name}
                    </Link>
                  </TableRowLink>
                </div>
              </TableHead>
              <TableCell className="max-w-[420px] text-[13.5px] text-secondary-foreground">
                {agency.legalBasis}
              </TableCell>
              <Count value={agency.counts?.activated} />
              <Count value={agency.counts?.invited} />
              <Count value={agency.counts?.revoked} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Count({ value }: { value: number | undefined }) {
  return (
    <TableCell className="text-right text-[14px] tabular-nums">
      {value ?? (
        <span className="text-muted-foreground" title={m.countUnknown}>
          -
        </span>
      )}
    </TableCell>
  );
}
