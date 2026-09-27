import { Alert, AlertDescription, AlertTitle, Button, Card, Icon } from '@adili/ui';
import {
  AlertCircleIcon,
  Flag02Icon,
  MinusSignIcon,
  PencilEdit02Icon,
  Tick02Icon,
  Upload04Icon,
  UserAdd01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type { ImportCounts, RosterImport } from '../../server/directory/client';
import { formatDateTime, formatNumber } from '../format';
import { messages as m } from './messages';
import { Tile, TileValue } from './tile';
import { WizardTitle } from './wizard-card';

const TILES = [
  { key: 'created', label: m.created, icon: UserAdd01Icon },
  { key: 'updated', label: m.updated, icon: PencilEdit02Icon },
  { key: 'unchanged', label: m.unchanged, icon: MinusSignIcon },
  { key: 'rejected', label: m.rejected, icon: AlertCircleIcon },
  { key: 'flaggedAbsent', label: m.flaggedAbsent, icon: Flag02Icon },
] as const satisfies readonly { key: keyof ImportCounts; label: string; icon: unknown }[];

/**
 * Step 5: the finished import's counts, a warning when officers were flagged as absent, then
 * the way to another file or back to the roster.
 */
export function WizardReportStep({
  imp,
  onImportAnother,
}: {
  imp: RosterImport;
  onImportAnother: () => void;
}) {
  const counts = imp.counts;
  const rows = imp.totalRows ?? counts?.accepted ?? 0;
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
      {counts ? (
        <>
          <section
            aria-label={m.importCounts}
            className="mt-5 grid grid-cols-2 gap-3 min-[900px]:grid-cols-5"
          >
            {TILES.map((tile) => (
              <Tile key={tile.key} icon={tile.icon} label={tile.label}>
                <TileValue>{formatNumber(counts[tile.key])}</TileValue>
              </Tile>
            ))}
          </section>
          {counts.flaggedAbsent > 0 ? (
            <Alert variant="warning" role="status" className="mt-4">
              <Icon icon={Flag02Icon} />
              <AlertTitle>{m.flaggedTitle(counts.flaggedAbsent)}</AlertTitle>
              <AlertDescription>{m.flaggedText}</AlertDescription>
            </Alert>
          ) : null}
          {counts.rejected === 0 ? (
            <Alert variant="success" role="status" className="mt-4">
              <Icon icon={Tick02Icon} />
              <AlertTitle>{m.noneRejected}</AlertTitle>
            </Alert>
          ) : null}
        </>
      ) : null}
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
