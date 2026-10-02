import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  IconTile,
  Skeleton,
  Spinner,
} from '@adili/ui';
import {
  Alert02Icon,
  Clock01Icon,
  Shield01Icon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons';

import { budgetResetDate, failureReasonText } from './copilot-view';
import { Callout, PanelBody, RetryButton, SessionEnded } from './panel-parts';
import { messages as t } from './messages';

/** The Copilot panel while it has no outputs to show: waiting, not enabled, failed. */

const SKELETON_WIDTHS = [92, 80, 96, 60, 0, 40, 88, 75, 83, 0, 45, 90, 70];

export function Waiting({
  stopped,
  sessionEnded = false,
  onCheckAgain,
}: {
  stopped: boolean;
  /** The session ended while waiting: polling stopped for good. */
  sessionEnded?: boolean;
  onCheckAgain: () => void;
}) {
  if (sessionEnded) {
    return (
      <PanelBody className="pt-3">
        <SessionEnded />
      </PanelBody>
    );
  }
  return (
    <PanelBody className="pt-3">
      {stopped ? (
        <Callout
          tone="neutral"
          icon={Clock01Icon}
          action={<RetryButton onClick={onCheckAgain}>{t.checkAgain}</RetryButton>}
        >
          {t.stillPreparing}
        </Callout>
      ) : (
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-ai">
          <Spinner className="size-3.5" />
          {t.pending}
        </p>
      )}
      <div className="grid gap-2.5" aria-busy="true">
        {SKELETON_WIDTHS.map((width, index) =>
          width ? (
            <Skeleton key={index} style={{ width: `${String(width)}%` }} />
          ) : (
            <span key={index} aria-hidden="true" className="h-1.5" />
          ),
        )}
      </div>
    </PanelBody>
  );
}

export function NotEnabled({ onLearnWhy }: { onLearnWhy: () => void }) {
  return (
    <div className="grid justify-items-center gap-2.5 px-5 pt-9 pb-10 text-center">
      <IconTile size="lg" className="text-muted-foreground">
        <Icon icon={UnavailableIcon} />
      </IconTile>
      <p className="max-w-[300px] text-sm">{t.notEnabled}</p>
      <Button variant="link" className="text-sm" onClick={onLearnWhy}>
        {t.learnWhy}
      </Button>
    </div>
  );
}

export function Failed({
  reason,
  canRetry,
  retrying,
  onRetry,
  now,
}: {
  reason: string | null;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
  now: Date;
}) {
  return (
    <PanelBody>
      <Callout
        tone="warning"
        icon={Alert02Icon}
        action={
          canRetry ? (
            <RetryButton onClick={onRetry} disabled={retrying}>
              {t.tryAgain}
            </RetryButton>
          ) : null
        }
      >
        {t.failed(failureReasonText(reason))}
        {reason === 'budget' ? (
          <div className="mt-0.5 text-[13px]">{t.budgetResets(budgetResetDate(now))}</div>
        ) : null}
      </Callout>
      <p className="text-[13px] text-muted-foreground">{t.worksAsUsual}</p>
    </PanelBody>
  );
}

export function WhyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3">
          <IconTile tone="default">
            <Icon icon={Shield01Icon} />
          </IconTile>
          <DialogTitle>{t.why.title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-3 text-[15px] leading-relaxed">
          {t.why.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t.why.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
