import { Alert, AlertDescription, AlertTitle, Button, Card, EmptyState, Icon } from '@adili/ui';
import { AlertCircleIcon, File01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { PAGE_SIZES, type PageSize } from '../../declaration/my-declarations';
import type { MyDeclarationsPage } from '../../server/my-declarations.server';
import type { Unavailable } from '../../server/results';
import { HomeLink } from '../home-link';
import { MY_DECLARATIONS_COPY as COPY } from './copy';
import { DraftRow, FiledRow } from './declaration-row';
import { Pager } from './pager';

export interface MyDeclarationsViewProps {
  result: MyDeclarationsPage | Unavailable;
  onPage: (page: number) => void;
  onPageSize: (pageSize: PageSize) => void;
}

/**
 * "My declarations" (spec 06 FE-4): drafts and amendments in progress first, then filed
 * declarations by statement date, a page at a time; the pager shows once there is more than
 * the smallest page.
 */
export function MyDeclarationsView({ result, onPage, onPageSize }: MyDeclarationsViewProps) {
  return (
    <div>
      <HomeLink label={COPY.home} />
      <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">
        {COPY.title}
      </h1>
      <div className="mt-5 grid gap-3">
        {result.status === 'unavailable' ? (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertTitle>{COPY.unavailable}</AlertTitle>
            <AlertDescription>{COPY.unavailableHint}</AlertDescription>
          </Alert>
        ) : result.total === 0 ? (
          <Card className="p-0 sm:p-0">
            <EmptyState
              icon={<Icon icon={File01Icon} />}
              title={COPY.emptyTitle}
              description={COPY.emptyText}
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link to="/">{COPY.goHome}</Link>
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            <ul className="grid gap-3.5">
              {result.rows.map((row) =>
                row.kind === 'draft' ? (
                  <DraftRow key={row.declaration.id} declaration={row.declaration} />
                ) : (
                  <FiledRow key={row.declaration.id} declaration={row.declaration} />
                ),
              )}
            </ul>
            {result.total > PAGE_SIZES[0] ? (
              <Pager
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                onPage={onPage}
                onPageSize={onPageSize}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
