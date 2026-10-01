import { Alert, AlertDescription, Button, Icon, RadioCard, RadioGroup } from '@adili/ui';
import { CreditCardIcon, Globe02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { useNavigate } from '@tanstack/react-router';
import { type SubmitEvent, useState } from 'react';

import type { IdentityDocumentKind } from '../../server/directory/types';
import { START_AGAIN_NOTICES, type StartAgainNotice } from '../onboarding/problems';
import { StepHeading } from '../onboarding/onboarding-layout';

const QUESTION = 'How will you identify yourself?';

/**
 * Step 1, Choose your ID: a Kenyan national ID, checked with the national register, or a
 * passport, checked by the Commission later. `notice` says why the applicant is starting again.
 */
export function IdTypeStep({
  preselected,
  notice,
}: {
  preselected?: IdentityDocumentKind;
  notice?: StartAgainNotice;
}) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<IdentityDocumentKind | undefined>(preselected);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (kind) void navigate({ to: '/access/get-started/details', search: { kind } });
  }

  return (
    <>
      {notice ? (
        <Alert variant="info" role="alert" className="mb-5">
          <Icon icon={InformationCircleIcon} />
          <AlertDescription>{START_AGAIN_NOTICES[notice]}</AlertDescription>
        </Alert>
      ) : null}
      <StepHeading title={QUESTION} />
      <form noValidate onSubmit={submit} className="mt-[22px] grid gap-[22px]">
        <RadioGroup legend={QUESTION} legendHidden columns={2}>
          <RadioCard
            layout="tile"
            name="kind"
            value="national-id"
            label="Kenyan national ID"
            description="Checked with the national register"
            icon={<Icon icon={CreditCardIcon} />}
            checked={kind === 'national-id'}
            onChange={() => {
              setKind('national-id');
            }}
          />
          <RadioCard
            layout="tile"
            name="kind"
            value="passport"
            label="Passport"
            description="Checked by the Commission later"
            icon={<Icon icon={Globe02Icon} />}
            checked={kind === 'passport'}
            onChange={() => {
              setKind('passport');
            }}
          />
        </RadioGroup>
        <Button type="submit" className="w-full" disabled={!kind}>
          Continue
        </Button>
      </form>
    </>
  );
}
