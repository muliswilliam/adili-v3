import { Button, cn, Icon, textLink } from '@adili/ui';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link } from '@tanstack/react-router';

import { ACCESS_LANDING_COPY as COPY } from '../../access/copy';
import { redirectSignedInApplicant } from '../../components/applicant-onboarding/guard';
import { AuthShell } from '../../components/auth-shell';
import { SIGN_IN } from '../../components/onboarding/links';

export const Route = createFileRoute('/access/')({
  loader: redirectSignedInApplicant,
  head: () => ({ meta: [{ title: COPY.title }] }),
  component: AccessLanding,
});

/** Where members of the public start: Get started as an applicant, or sign in. */
function AccessLanding() {
  return (
    <AuthShell art="access">
      <h1 className="text-[30px] leading-[1.2] font-semibold tracking-[-0.02em] text-balance">
        {COPY.heading}
      </h1>
      <p className="mt-2 text-muted-foreground">{COPY.lead}</p>
      <div className="mt-[26px] grid gap-2.5">
        <Button asChild className="w-full">
          <Link to="/access/get-started">
            {COPY.getStarted}
            <Icon icon={ArrowRight01Icon} />
          </Link>
        </Button>
        <Button asChild variant="secondary" className="w-full">
          <a href={SIGN_IN}>{COPY.signIn}</a>
        </Button>
      </div>
      <p className="mt-3.5 text-[13.5px] text-muted-foreground">
        {COPY.publicOfficer}{' '}
        <Link to="/" className={cn(textLink, 'font-medium')}>
          {COPY.declareHere}
        </Link>
      </p>
    </AuthShell>
  );
}
