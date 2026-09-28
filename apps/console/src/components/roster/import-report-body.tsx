import { Alert, AlertDescription, AlertTitle, Button, Icon } from '@adili/ui';
import {
  AlertCircleIcon,
  Flag02Icon,
  InformationCircleIcon,
  MinusSignIcon,
  PencilEdit02Icon,
  Tick02Icon,
  UserAdd01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type {
  DirectoryResult,
  ImportCounts,
  RosterImport,
  RosterImportRowPage,
} from '../../server/directory/client';
import { formatNumber } from '../format';
import { goToSignIn } from '../sign-in-redirect';
import { rowsPurged } from './import-report';
import { messages as m } from './messages';
import { RejectedRows } from './rejected-rows';
import { Tile, TileValue } from './tile';
import {
  type RejectedRowsDeps,
  type RejectedRowsPager,
  useRejectedRows,
} from './use-rejected-rows';
import { useReportDownload } from './use-report-download';

const TILES = [
  { key: 'created', label: m.created, icon: UserAdd01Icon },
  { key: 'updated', label: m.updated, icon: PencilEdit02Icon },
  { key: 'unchanged', label: m.unchanged, icon: MinusSignIcon },
  { key: 'rejected', label: m.rejected, icon: AlertCircleIcon },
  { key: 'flaggedAbsent', label: m.flaggedAbsent, icon: Flag02Icon },
] as const satisfies readonly { key: keyof ImportCounts; label: string; icon: unknown }[];

/**
 * What an ended import did (wizard step 5 and the import report): the five counts, a warning
 * with the way to review them when officers were flagged as absent, a note when some are on
 * another Commission's roster too, then the rejected rows with their CSV, or that none were
 * rejected. Nothing while the import has no counts.
 */
export function ImportReportBody({
  imp,
  readRows,
  returnTo,
  initialRows,
  rowsPager,
}: {
  imp: RosterImport;
  /** Reads a page of the import's rejected rows (`listRejectedRows` in the app). */
  readRows: RejectedRowsDeps['read'];
  /** Where signing in again comes back to. */
  returnTo: string;
  /** The page of rejected rows on show, when the route's loader read it. */
  initialRows?: DirectoryResult<RosterImportRowPage>;
  /** Keeps the page of rejected rows on show in the URL; otherwise in component state. */
  rowsPager?: RejectedRowsPager;
}) {
  const counts = imp.counts;
  if (!counts) return null;
  return (
    <>
      <section
        aria-label={m.importCounts}
        className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-5"
      >
        {TILES.map((tile) => (
          <Tile
            key={tile.key}
            icon={tile.icon}
            label={tile.label}
            // Five across: the prototype's tighter tile padding keeps each label on one line.
            className="p-4 sm:p-4"
          >
            <TileValue>{formatNumber(counts[tile.key])}</TileValue>
          </Tile>
        ))}
      </section>
      {counts.flaggedAbsent > 0 ? (
        <Alert variant="warning" role="status" className="mt-4">
          <Icon icon={Flag02Icon} />
          <AlertTitle>{m.flaggedTitle(counts.flaggedAbsent)}</AlertTitle>
          <AlertDescription>
            {m.flaggedText}
            <Button asChild variant="secondary" size="sm" className="mt-2.5 flex w-fit">
              <Link to="/roster/flagged">{m.reviewFlaggedButton}</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {counts.noted > 0 ? (
        <Alert variant="info" role="status" className="mt-4">
          <Icon icon={InformationCircleIcon} />
          <AlertTitle>{m.notedTitle(counts.noted)}</AlertTitle>
          <AlertDescription>{m.notedText}</AlertDescription>
        </Alert>
      ) : null}
      {counts.rejected === 0 ? (
        <Alert variant="success" role="status" className="mt-4">
          <Icon icon={Tick02Icon} />
          <AlertTitle>{m.noneRejected}</AlertTitle>
        </Alert>
      ) : (
        <ImportRejectedRows
          imp={imp}
          readRows={readRows}
          returnTo={returnTo}
          initialRows={initialRows}
          rowsPager={rowsPager}
        />
      )}
    </>
  );
}

function ImportRejectedRows({
  imp,
  readRows,
  returnTo,
  initialRows,
  rowsPager,
}: {
  imp: RosterImport;
  readRows: RejectedRowsDeps['read'];
  returnTo: string;
  initialRows?: DirectoryResult<RosterImportRowPage>;
  rowsPager?: RejectedRowsPager;
}) {
  // Past the retention date the directory has purged the rows (410): say so without asking.
  const purged = rowsPurged(imp);
  const rows = useRejectedRows(
    purged ? null : imp.id,
    {
      read: readRows,
      onUnauthenticated: () => {
        goToSignIn(returnTo);
      },
    },
    { initial: initialRows, pager: rowsPager },
  );
  const { downloading, download } = useReportDownload(imp, returnTo);
  return (
    <RejectedRows
      imp={imp}
      view={purged ? { phase: 'failed', failure: 'purged' } : rows.view}
      downloading={downloading}
      onDownload={() => void download()}
      onNext={rows.next}
      onPrevious={rows.previous}
      onRetry={rows.retry}
    />
  );
}
