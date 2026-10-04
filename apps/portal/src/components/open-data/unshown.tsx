import { SuppressionLegend, SuppressionMarker, type UnshownFigureKind } from '@adili/ui';

import { type Language, SWAHILI_LEGEND, SWAHILI_MARKERS } from '../../open-data/copy';

/**
 * The shared suppression primitives (#349) in the page's language: every use on the Open data
 * page goes through here, so the primitives' words and props are set in one place.
 */
export function Unshown({
  kind,
  threshold,
  language,
}: {
  kind: UnshownFigureKind;
  threshold: number;
  language: Language;
}) {
  return (
    <SuppressionMarker
      kind={kind}
      threshold={threshold}
      messages={language === 'sw' ? SWAHILI_MARKERS : undefined}
    />
  );
}

export function UnshownLegend({
  threshold,
  cellsSuppressed,
  keys,
  language,
  className,
}: {
  threshold: number;
  cellsSuppressed?: number;
  keys?: readonly UnshownFigureKind[];
  language: Language;
  className?: string;
}) {
  return (
    <SuppressionLegend
      threshold={threshold}
      cellsSuppressed={cellsSuppressed}
      keys={keys}
      messages={language === 'sw' ? SWAHILI_LEGEND : undefined}
      markerMessages={language === 'sw' ? SWAHILI_MARKERS : undefined}
      className={className}
    />
  );
}
