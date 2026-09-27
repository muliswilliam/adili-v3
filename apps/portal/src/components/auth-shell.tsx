import { Button, Icon, LogoWordmark, ToastProvider, useToast } from '@adili/ui';
import { Globe02Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { AuthArt, type AuthArtVariant } from './auth-art';

/**
 * Page chrome for the signed-out pages (landing and Get started): the form column with the logo
 * and sign-in link, and the photo panel beside it from 1000px. Follows the prototype's `.auth`.
 */
export function AuthShell({ art, children }: { art: AuthArtVariant; children: ReactNode }) {
  return (
    // Above the pages, so a toast such as "Email verified" survives the move to the next step.
    <ToastProvider>
      <div className="grid min-h-dvh grid-cols-1 min-[1000px]:grid-cols-[minmax(460px,1fr)_minmax(0,1.15fr)]">
        <div className="flex min-h-dvh flex-col p-5 min-[700px]:px-10 min-[700px]:py-7">
          <header className="flex min-h-9 items-center justify-between gap-4">
            <a
              href="/"
              className="-mx-1 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogoWordmark />
            </a>
            <div className="flex items-center gap-1">
              <LanguageButton />
              <Button asChild variant="ghost" size="sm">
                <a href="/auth/login">Sign in</a>
              </Button>
            </div>
          </header>
          <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col pt-7 pb-8 min-[700px]:justify-center min-[700px]:pt-8">
            {children}
          </main>
        </div>
        <AuthArt variant={art} />
      </div>
    </ToastProvider>
  );
}

/** English is the only language for now; the button says so until Kiswahili is added. */
function LanguageButton() {
  const { toast } = useToast();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="hidden min-[520px]:inline-flex"
      onClick={() => {
        toast({ title: 'Kiswahili will follow. English only for now.' });
      }}
    >
      <Icon icon={Globe02Icon} />
      English
    </Button>
  );
}
