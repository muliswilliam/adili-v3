import { Button, Card, Icon } from '@adili/ui';
import { Tick02Icon, Upload04Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type { RosterImport } from '../../server/directory/client';
import { formatDateTime } from '../format';
import { reportCsvUrl } from './import-report';
import { ImportReportBody } from './import-report-body';
import { messages as m } from './messages';
import type { RejectedRowsDeps } from './use-rejected-rows';
import { WizardTitle } from './wizard-card';

/**
 * Step 5: the finished import's counts, a warning when officers were flagged as absent, the
 * rejected rows with their CSV, then the way to another file or back to the roster.
 */
export function WizardReportStep({
  imp,
  readRows,
  returnTo,
  onImportAnother,
}: {
  imp: RosterImport;
  readRows: RejectedRowsDeps['read'];
  /** Where signing in again comes back to. */
  returnTo: string;
  onImportAnother: () => void;
}) {
  const rows = imp.totalRows ?? imp.counts?.accepted ?? 0;
  return (
    <>
      <Card className="mt-5 flex-row items-start gap-3.5">
        <span
          aria-hidden="true"
          className="grid size-[34px] shrink-0 place-items-center rounded-full bg-success-subtle text-success [&_svg]:size-[18px]"
        >
          <Icon icon={Tick02Icon} strokeWidth={2.4} />
        </span>
        <div className="min-w-0">
          <WizardTitle>{m.reportTitle}</WizardTitle>
          <p className="mt-1 text-[13.5px] break-words text-muted-foreground">
            {m.reportMeta(
              imp.fileName,
              rows,
              imp.completedAt ? formatDateTime(imp.completedAt) : null,
            )}
          </p>
        </div>
      </Card>
      <div className="mt-5">
        <ImportReportBody
          imp={imp}
          readRows={readRows}
          returnTo={returnTo}
          reportCsvUrl={reportCsvUrl(imp.id)}
          reviewFlagged={<Link to="/roster/flagged">{m.reviewFlaggedButton}</Link>}
        />
      </div>
      <div className="mt-6 flex flex-wrap gap-2.5">
        <Button onClick={onImportAnother}>
          <Icon icon={Upload04Icon} />
          {m.importAnother}
        </Button>
        <Button asChild variant="secondary">
          <Link to="/roster">{m.goToRoster}</Link>
        </Button>
      </div>
    </>
  );
}
