import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  IconTile,
  Spinner,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Download01Icon,
  File01Icon,
  UnavailableIcon,
  UserBlock01Icon,
} from '@hugeicons/core-free-icons';

import type { LeaOfficerAccount } from '../../server/directory/client';
import { Consequences } from '../access/resolve-dialogs';
import { messages as m } from './messages';

/**
 * "Revoke …?" (S11): the officer's account is disabled at once; what they already filed stays
 * on record.
 */
export function RevokeDialog({
  officer,
  busy,
  error,
  onOpenChange,
  onConfirm,
}: {
  /** The officer to revoke; null keeps the dialog closed. */
  officer: LeaOfficerAccount | null;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={officer !== null} onOpenChange={onOpenChange}>
      <DialogContent busy={busy} aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile tone="destructive">
            <Icon icon={UserBlock01Icon} />
          </IconTile>
          <DialogTitle>{officer ? m.revokeTitle(officer.name) : null}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <Consequences
            items={[
              {
                icon: UnavailableIcon,
                title: m.cannotSignIn,
                text: m.cannotSignInText,
                danger: true,
              },
              { icon: Download01Icon, title: m.noDownloads },
              { icon: File01Icon, title: m.stayOnRecord, text: m.stayOnRecordText },
            ]}
          />
          {error ? (
            <Alert variant="destructive" role="alert">
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {m.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {busy ? <Spinner className="size-4" /> : null}
            {busy ? m.revoking : m.revokeAccess}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
