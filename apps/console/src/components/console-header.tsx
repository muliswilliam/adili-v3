import { SiteHeader } from '@adili/ui';

import { SignOutButton } from './sign-out-button';

/** Header of every signed-in console page. */
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
