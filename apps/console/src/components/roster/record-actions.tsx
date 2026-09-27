import { Button, Dialog, DialogTrigger, Icon, useToast } from '@adili/ui';
import { Loading03Icon, Logout03Icon, UserCheck01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import type { RosterRecord } from '../../server/directory/client';
import { keepRosterRecords } from '../../server/roster-exits';
import { ConfirmExitsDialogContent } from './confirm-exits-dialog';
import { keepFailure } from './exits';
import { messages as m } from './messages';
import { isFlagged } from './record-imports';

const unavailable = { ok: false, error: { kind: 'unavailable', detail: null } } as const;

/**
 * The reporting officer's actions on a record (spec 02, Screen: Record detail): "Mark as still
 * employed" while it is flagged, "Confirm exit" until it has exited. Nothing once exited.
 */
export function RecordActions({
  slug,
  record,
}: {
  slug: string;
  record: Pick<
    RosterRecord,
    'id' | 'fullName' | 'personnelFileNumber' | 'state' | 'absentFromLatestImport'
  >;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [exiting, setExiting] = useState(false);
  const [keeping, setKeeping] = useState(false);

  if (record.state === 'exited') return null;

  const signIn = () => {
    window.location.assign(`/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
  };

  const keep = async () => {
    if (keeping) return;
    setKeeping(true);
    const outcome = await keepRosterRecords({
      data: { slug, idempotencyKey: crypto.randomUUID(), recordIds: [record.id] },
    }).catch(() => unavailable);
    setKeeping(false);
    if (outcome.ok) {
      toast({ title: m.keptToast(1) });
      void router.invalidate();
      return;
    }
    const failure = keepFailure(outcome.error);
    if (failure.kind === 'sign-in') signIn();
    else toast({ title: failure.message, urgency: 'assertive' });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {isFlagged(record) ? (
        <Button
          variant="secondary"
          disabled={keeping}
          aria-busy={keeping || undefined}
          onClick={() => void keep()}
        >
          <Icon
            icon={keeping ? Loading03Icon : UserCheck01Icon}
            className={keeping ? 'animate-spin' : undefined}
          />
          {keeping ? m.markingStillEmployed : m.markStillEmployed}
        </Button>
      ) : null}
      <Dialog open={exiting} onOpenChange={setExiting}>
        <DialogTrigger asChild>
          <Button variant="secondary" disabled={keeping}>
            <Icon icon={Logout03Icon} />
            {m.confirmExit}
          </Button>
        </DialogTrigger>
        {exiting ? (
          <ConfirmExitsDialogContent
            slug={slug}
            officers={[record]}
            onConfirmed={() => {
              setExiting(false);
              toast({ title: m.exitsRecorded(1) });
              void router.invalidate();
            }}
            onStale={(message) => {
              setExiting(false);
              toast({ title: message, urgency: 'assertive' });
              void router.invalidate();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
