import { Button, Icon } from '@adili/ui';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link } from '@tanstack/react-router';

import { AuthShell } from '../../components/auth-shell';
import { SIGN_IN } from '../../components/onboarding/links';

export const Route = createFileRoute('/access/')({
  head: () => ({ meta: [{ title: 'Request access to a declaration · Adili Online' }] }),
  component: AccessLanding,
});

/** Where members of the public start: Get started as an applicant, or sign in. */
function AccessLanding() {
  return (
    <AuthShell art="access">
      <h1 className="text-[30px] leading-[1.2] font-semibold tracking-[-0.02em] text-balance">
        Request access to a declaration
      </h1>
      <p className="mt-2 text-muted-foreground">
        For members of the public, with a national ID or passport.
      </p>
      <div className="mt-[26px] grid gap-2.5">
        <Button asChild className="w-full">
          <Link to="/access/get-started">
            Get started
            <Icon icon={ArrowRight01Icon} />
          </Link>
        </Button>
        <Button asChild variant="secondary" className="w-full">
          <a href={SIGN_IN}>Sign in</a>
        </Button>
      </div>
      <p className="mt-3.5 text-[13.5px] text-muted-foreground">
        Public officer?{' '}
        <Link
          to="/"
          className="font-medium text-foreground underline decoration-input underline-offset-3 hover:decoration-foreground"
        >
          Declare here
        </Link>
      </p>
    </AuthShell>
  );
}
