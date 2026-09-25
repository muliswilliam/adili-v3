import { SiteHeader } from '@adili/ui';

import { SignOutButton } from './sign-out-button';

/** Header for signed-in pages: the user's name and a sign-out button. */
export function ConsoleHeader({ userName }: { userName: string }) {
  return (
    <SiteHeader
      product="Console"
      actions={
        <>
          <span className="hidden text-sm text-muted-foreground sm:inline">{userName}</span>
          <SignOutButton />
        </>
      }
    />
  );
}
