import { Alert, AlertDescription, AlertTitle, Button, FormField, Icon } from '@adili/ui';
import { AlertCircleIcon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import type { OnboardingCommission } from '../../server/directory/types';
import { CommissionPicker } from './commission-picker';
import { StepHeading } from './onboarding-layout';
import {
  GENERIC_ERROR,
  problemMessage,
  START_AGAIN_NOTICES,
  type StartAgainNotice,
} from './problems';

/**
 * Step 1, Choose your Commission. Continue waits for a Commission that has imported its roster;
 * the file number only means something within one (ADR-014).
 */
export function CommissionStep({
  commissions,
  preselected,
  notice,
}: {
  /** Null when the directory could not list them. */
  commissions: OnboardingCommission[] | null;
  preselected?: string;
  notice?: StartAgainNotice;
}) {
  return (
    <>
      {notice ? (
        <Alert variant="info" className="mb-5">
          <Icon icon={InformationCircleIcon} />
          <AlertDescription>{START_AGAIN_NOTICES[notice]}</AlertDescription>
        </Alert>
      ) : null}
      <StepHeading title="Choose your Commission" />
      {commissions ? (
        <CommissionForm
          commissions={commissions}
          preselected={
            commissions.some((entry) => entry.slug === preselected) ? preselected : undefined
          }
        />
      ) : (
        <CommissionsUnavailable />
      )}
    </>
  );
}

function CommissionForm({
  commissions,
  preselected,
}: {
  commissions: OnboardingCommission[];
  preselected?: string;
}) {
  const navigate = useNavigate();
  const [slug, setSlug] = useState(preselected ?? null);
  const [open, setOpen] = useState(false);
  const selected = commissions.find((entry) => entry.slug === slug);
  const ready = selected?.hasRoster === true && !open;

  return (
    // Works as a plain GET form too, should Continue be pressed before the page has hydrated.
    <form
      noValidate
      action="/get-started/identify"
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready)
          void navigate({ to: '/get-started/identify', search: { commission: selected.slug } });
      }}
    >
      <FormField
        label="Responsible Commission"
        hint="Not your school, ministry or department."
        className="mt-5"
      >
        <CommissionPicker
          commissions={commissions}
          value={slug}
          onValueChange={setSlug}
          onOpenChange={setOpen}
        />
      </FormField>
      {selected && !selected.hasRoster ? (
        <Alert variant="warning" className="mt-3.5">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>
            {problemMessage('no-roster', { commissionName: selected.name })}
          </AlertDescription>
        </Alert>
      ) : null}
      {ready ? <input type="hidden" name="commission" value={selected.slug} /> : null}
      <Button type="submit" className="mt-[22px] w-full" disabled={!ready}>
        Continue
      </Button>
    </form>
  );
}

/** The directory could not list the Commissions. */
export function CommissionsUnavailable() {
  const router = useRouter();
  return (
    <Alert variant="destructive" className="mt-5">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>We could not load the list of Commissions</AlertTitle>
      <AlertDescription>{GENERIC_ERROR}</AlertDescription>
      <Button
        variant="secondary"
        size="sm"
        className="mt-2 w-fit"
        onClick={() => {
          void router.invalidate();
        }}
      >
        Try again
      </Button>
    </Alert>
  );
}
