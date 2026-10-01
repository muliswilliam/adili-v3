import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatDate,
  Icon,
  IconTile,
  obligationTypeLabel,
} from '@adili/ui';
import { File01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { COPIES_COPY as COPY, TRANSPARENCY_COPY } from '../../access/history-copy';
import { pageOfEntries } from '../../access/history';
import type { CertifiedCopy } from '../../server/access/types';
import type { SubmittedVersion } from '../../server/my-declarations.server';
import { Pager } from '../access/requests-list';
import { FootNote } from '../access-history/transparency-frame';
import { CopyAction, CopyNote } from './copy-action';
import { useCertifiedCopies } from './use-certified-copies';

/** Versions to a page, as in the prototype. */
export const COPIES_PAGE_SIZE = 5;

/**
 * Certified copies (spec 10 FE-4, S13): every submitted version of the declarant's
 * declarations, newest first, five to a page, each with Request certified copy, "Preparing…"
 * and Download. The certified-copy-ready SMS and email link here.
 */
export function CopiesView({
  versions,
  copies: known,
  page,
  onPage,
}: {
  versions: SubmittedVersion[];
  copies: CertifiedCopy[];
  page: number;
  onPage: (page: number) => void;
}) {
  const copies = useCertifiedCopies(known);
  if (versions.length === 0) {
    return (
      <Card className="p-0 sm:p-0">
        <EmptyState
          className="py-14"
          icon={<Icon icon={File01Icon} />}
          title={COPY.emptyTitle}
          description={COPY.emptyText}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/">{TRANSPARENCY_COPY.goHome}</Link>
            </Button>
          }
        />
      </Card>
    );
  }
  const shown = pageOfEntries(versions, page, COPIES_PAGE_SIZE);
  return (
    <div className="grid gap-4">
      <Card className="gap-0 overflow-hidden p-0 sm:p-0">
        <ul aria-label={COPY.listLabel}>
          {shown.entries.map((each) => {
            const { version } = each;
            const type = obligationTypeLabel(each.type, each.statementDate);
            const label = `${type}, ${COPY.versionLine(version.version)}`;
            const target = {
              commission: each.commission.slug,
              declarationId: each.declarationId,
              version: version.version,
            };
            return (
              <li
                key={`${each.declarationId}:${String(version.version)}`}
                className="flex flex-wrap items-center gap-x-3.5 gap-y-3 px-5 py-4 not-first:border-t not-first:border-border sm:flex-nowrap sm:px-6"
              >
                <IconTile size="sm">
                  <Icon icon={File01Icon} />
                </IconTile>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px] font-medium">
                    {type}
                    <span className="font-normal text-muted-foreground">
                      · {COPY.versionLine(version.version)}
                    </span>
                    {version.supersededAt !== null ? (
                      <Badge className="ml-1">{COPY.superseded}</Badge>
                    ) : null}
                  </p>
                  <p className="text-[13.5px] text-muted-foreground">
                    <span className="font-mono text-[12.5px] whitespace-nowrap">
                      {version.reference}
                    </span>{' '}
                    ·{' '}
                    <span className="whitespace-nowrap">
                      {COPY.submitted(formatDate(version.submittedAt))}
                    </span>
                  </p>
                  <CopyNote target={target} copies={copies} />
                </div>
                <div className="ml-auto shrink-0">
                  <CopyAction target={target} label={label} copies={copies} />
                </div>
              </li>
            );
          })}
        </ul>
        <Pager
          page={shown.page}
          total={versions.length}
          pageSize={COPIES_PAGE_SIZE}
          label={COPY.pagination}
          onPage={onPage}
        />
      </Card>
      <FootNote text={COPY.footNote} tip={COPY.aboutText} tipLabel={COPY.about} />
    </div>
  );
}
