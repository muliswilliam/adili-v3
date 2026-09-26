import { Button, Logo } from '@adili/ui';
import type { ReactNode } from 'react';

/** Page chrome for the Get started flow: centred logo, sign-in link and the warm glow. */
export function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-glow">
      <header className="relative flex h-14 items-center justify-center px-4 sm:px-6">
        <a
          href="/"
          className="rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo />
        </a>
        <div className="absolute right-4 sm:right-6">
          <Button asChild variant="ghost" size="sm">
            <a href="/auth/login">Sign in</a>
          </Button>
        </div>
      </header>
      <main className="flex flex-1 justify-center px-4 pt-12 pb-24 sm:pt-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

/** Heading block for a step: one h1 per page, centred like the design. */
export function StepHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="grid gap-1.5 text-center">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export function HelpFooter({
  children = "Need help? Contact your Commission's reporting officer.",
}: {
  children?: ReactNode;
}) {
  return <p className="mt-8 text-center text-[13px] text-muted-foreground">{children}</p>;
}
