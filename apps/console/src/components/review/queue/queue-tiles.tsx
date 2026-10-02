import { PRIORITY_BADGE_MESSAGES, StatTile, StatTileSkeleton } from '@adili/ui';

import { QUEUE_COPY as m } from '../../../review-queue/messages';
import {
  QUEUE_TILES,
  type QueueSearch,
  tilePressed,
  toggleTile,
} from '../../../review-queue/query';
import { type QueueSummary, tileCount } from '../../../review-queue/rows';

const GRID = 'grid grid-cols-2 gap-3 min-[980px]:grid-cols-4';

export interface QueueTilesProps {
  /** Null while it loads. */
  summary: QueueSummary | null;
  search: QueueSearch;
  onSearchChange: (next: QueueSearch) => void;
}

/**
 * Unassigned, Mine, Awaiting clarification and Ready for determination, each with its High,
 * Medium and Low counts, and each a toggle that shows its cases alone in the list.
 */
export function QueueTiles({ summary, search, onSearchChange }: QueueTilesProps) {
  if (!summary) {
    return (
      <div aria-busy="true" aria-label={m.tilesLabel} role="group" className={GRID}>
        {QUEUE_TILES.map((tile) => (
          // The height of a loaded tile with its three bands, so nothing moves when they arrive.
          <StatTileSkeleton key={tile} lines={3} className="min-h-[167px]" />
        ))}
      </div>
    );
  }
  return (
    <div role="group" aria-label={m.tilesLabel} className={GRID}>
      {QUEUE_TILES.map((tile) => {
        const label = m.tiles[tile];
        const count = tileCount(summary, tile);
        return (
          <StatTile
            key={tile}
            label={label}
            value={count.total}
            breakdown={count.bands.map(({ band, value }) => ({
              label: PRIORITY_BADGE_MESSAGES.bands[band],
              value,
            }))}
            breakdownLabel={m.byPriority(label)}
            pressed={tilePressed(search, tile)}
            onPressedChange={() => {
              onSearchChange(toggleTile(search, tile));
            }}
          />
        );
      })}
    </div>
  );
}
