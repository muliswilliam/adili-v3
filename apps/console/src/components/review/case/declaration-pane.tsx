import type { Attachment, DeclarationV1 } from '@adili/forms';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  type AttachmentState,
  Badge,
  Button,
  cn,
  DeclarationSummary,
  focusRing,
  Icon,
} from '@adili/ui';
import { Flag02Icon, RefreshIcon, WifiDisconnected01Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { ItemPin } from '../../../review-case/flags';
import { CASE_COPY } from '../../../review-case/messages';

/** The pin colours of a flagged item, by its highest open severity (the kit's `.pinbtn`). */
const PIN_TONES: Record<ItemPin['severity'], string> = {
  high: 'bg-destructive-subtle text-destructive',
  medium: 'bg-warning-subtle text-warning',
  low: 'bg-info-subtle text-info-subtle-foreground',
  info: 'bg-muted text-secondary-foreground',
};

export const DECLARATION_ANCHORS = 'case-declaration';

/**
 * The declaration as filed (spec 07a FE-3), in a card under a sticky bar: the title and the
 * version, then the shared `DeclarationSummary` with each flagged item's pin ("2 indicators",
 * which opens its flag) and the attachments' downloads. When declarations could not give the
 * document (or gave one this console cannot read), a callout to try again; the rest of the case stays usable. `tools` sits at the end
 * of the bar, for the version compare (#167).
 */
export function DeclarationPane({
  document,
  version,
  versions,
  highlight,
  pins,
  onPin,
  onAttachment,
  attachmentState,
  onRetry,
  retrying,
  tools,
}: {
  document: DeclarationV1 | null;
  version: number;
  versions: number;
  highlight: string | null;
  pins: Map<string, ItemPin>;
  onPin: (flagId: string) => void;
  onAttachment: (attachment: Attachment) => void;
  attachmentState: (uploadId: string) => AttachmentState;
  onRetry: () => void;
  retrying: boolean;
  tools?: ReactNode;
}) {
  const copy = CASE_COPY.declaration;
  return (
    <section aria-labelledby="case-declaration-title" className="rounded-2xl bg-card shadow-card">
      <div className="sticky top-14 z-[4] flex flex-wrap items-center gap-2.5 rounded-t-2xl border-b bg-card/96 px-4 py-3 backdrop-blur-sm">
        <h2 id="case-declaration-title" className="text-[14.5px] font-semibold">
          {copy.title}
        </h2>
        {document ? <Badge>{CASE_COPY.version(version, versions)}</Badge> : null}
        {tools ? <div className="ml-auto flex items-center gap-2">{tools}</div> : null}
      </div>
      {document ? (
        <DeclarationSummary
          document={document}
          version={version}
          highlight={highlight}
          anchorPrefix={DECLARATION_ANCHORS}
          onAttachment={onAttachment}
          attachmentState={attachmentState}
          itemExtras={({ item }) => {
            const pin = pins.get(item.id);
            if (!pin) return null;
            return (
              <button
                type="button"
                aria-label={copy.pinnedLabel(pin.count)}
                className={cn(
                  focusRing,
                  'inline-flex h-6 cursor-pointer items-center gap-[5px] rounded-full px-2 text-xs font-semibold [&_svg]:size-3',
                  PIN_TONES[pin.severity],
                )}
                onClick={() => {
                  onPin(pin.flagId);
                }}
              >
                <Icon icon={Flag02Icon} strokeWidth={2.2} />
                {copy.pinned(pin.count)}
              </button>
            );
          }}
        />
      ) : (
        <div className="p-5">
          <Alert variant="warning" role="alert">
            <Icon icon={WifiDisconnected01Icon} />
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <AlertTitle>{copy.unavailableTitle}</AlertTitle>
                <AlertDescription>{copy.unavailableBody}</AlertDescription>
              </div>
              <Button variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>
                <Icon icon={RefreshIcon} />
                {CASE_COPY.retry}
              </Button>
            </div>
          </Alert>
        </div>
      )}
    </section>
  );
}
