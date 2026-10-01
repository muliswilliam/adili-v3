import {
  addDays,
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatDate,
  Icon,
  IconTile,
  type IconProps,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Cancel01Icon,
  ChartColumnIcon,
  Clock01Icon,
  Mail01Icon,
  Notification03Icon,
  SquareLock02Icon,
  UserCheck01Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { RosterCandidate } from '../../server/access/types';
import { messages as m } from './messages';

/** One consequence of confirming, with its icon (the prototype's `.conseq` list). */
function Consequences({
  items,
}: {
  items: { icon: IconProps['icon']; title: string; text?: string; danger?: boolean }[];
}) {
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li key={item.title} className="flex items-start gap-3">
          <IconTile size="sm" tone={item.danger ? 'destructive' : 'default'}>
            <Icon icon={item.icon} />
          </IconTile>
          <div className="grid gap-0.5 pt-1">
            <span className="text-[14.5px] leading-snug font-medium">{item.title}</span>
            {item.text ? (
              <span className="text-[13px] text-muted-foreground">{item.text}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  /** What went wrong on the last try, shown in the dialog; null when nothing did. */
  error: string | null;
  onConfirm: () => void;
}

function Problem({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function Footer({
  busy,
  confirm,
  variant,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  confirm: ReactNode;
  variant: 'default' | 'destructive';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
        {m.cancel}
      </Button>
      <Button
        type="button"
        variant={variant}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={onConfirm}
      >
        {confirm}
      </Button>
    </DialogFooter>
  );
}

/**
 * "Identify as …?" (S3): the officer Form K names is this roster record. The declarant is then
 * notified and has seven days for representations; it cannot be changed.
 */
export function ResolveDialog({
  record,
  now,
  ...props
}: ConfirmProps & { record: RosterCandidate | null; now: string }) {
  return (
    <Dialog open={props.open && record !== null} onOpenChange={props.onOpenChange}>
      <DialogContent busy={props.busy}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile>
            <Icon icon={UserCheck01Icon} />
          </IconTile>
          <DialogTitle>{record ? m.identifyAs(record.fullName) : null}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {record ? (
            <DialogDescription asChild>
              <div className="rounded-lg bg-muted px-3.5 py-3 text-sm text-foreground">
                <b className="font-semibold">{record.fullName}</b> ·{' '}
                {m.fileNumberInline(record.personnelFileNumber)}
                {record.designation || record.reportingEntity ? (
                  <div className="text-secondary-foreground">
                    {[record.designation, record.reportingEntity].filter(Boolean).join(', ')}
                  </div>
                ) : null}
              </div>
            </DialogDescription>
          ) : null}
          <Consequences
            items={[
              {
                icon: Notification03Icon,
                title: m.resolveDeclarantNotified,
                text: m.resolveDeclarantNotifiedText,
              },
              {
                icon: Clock01Icon,
                title: m.resolveWindow(formatDate(addDays(now, 7))),
                text: m.resolveWindowText,
              },
              { icon: SquareLock02Icon, title: m.resolveFinal },
            ]}
          />
          <Problem error={props.error} />
        </DialogBody>
        <Footer
          busy={props.busy}
          confirm={m.identifyAndNotify}
          variant="default"
          onCancel={() => {
            props.onOpenChange(false);
          }}
          onConfirm={props.onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Cannot identify the officer?" (S3): the request closes as cannot-identify, the applicant is
 * told, and Form M counts it declined for reason "other".
 */
export function CannotIdentifyDialog(props: ConfirmProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent busy={props.busy} aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile tone="destructive">
            <Icon icon={UserRemove01Icon} />
          </IconTile>
          <DialogTitle>{m.cannotTitle}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <Consequences
            items={[
              { icon: Cancel01Icon, title: m.cannotCloses, danger: true },
              { icon: Mail01Icon, title: m.cannotApplicantTold, text: m.cannotApplicantToldText },
              { icon: ChartColumnIcon, title: m.cannotFormM, text: m.cannotFormMText },
            ]}
          />
          <Problem error={props.error} />
        </DialogBody>
        <Footer
          busy={props.busy}
          confirm={m.closeRequest}
          variant="destructive"
          onCancel={() => {
            props.onOpenChange(false);
          }}
          onConfirm={props.onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}
