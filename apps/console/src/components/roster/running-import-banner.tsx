import { Alert, Button, Icon, Spinner } from '@adili/ui';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type { RosterImport } from '../../server/directory/client';
import { importProgress } from './import-progress';
import { messages as m } from './messages';

/** What the banner says about an import that is running: its rows once it knows them. */
export function runningImportText(
  imp: Pick<RosterImport, 'state' | 'totalRows' | 'processedRows'>,
): string {
  const progress = importProgress(imp);
  return progress.kind === 'reading'
    ? m.runningBannerReading
    : m.runningBanner(progress.processed, progress.total);
}

/**
 * The overview's "import in progress" state: which import runs, how far it got, and the way to
 * it. Announced politely as the progress changes.
 */
export function RunningImportBanner({ imp }: { imp: RosterImport }) {
  return (
    <Alert
      variant="info"
      role="status"
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <Spinner className="size-4" />
      <p className="min-w-0 flex-1 font-medium">{runningImportText(imp)}</p>
      <Button asChild variant="secondary" size="sm">
        <Link to="/roster/imports/$importId" params={{ importId: imp.id }}>
          {m.viewRunningImport}
          <Icon icon={ArrowRight01Icon} />
        </Link>
      </Button>
    </Alert>
  );
}
