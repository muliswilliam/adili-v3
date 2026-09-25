import { Button } from '@adili/ui';
import { LogOut } from 'lucide-react';

/** A form POST so logout cannot be triggered by a cross-site link. */
export function SignOutButton() {
  return (
    <form method="post" action="/auth/logout">
      <Button type="submit" variant="outline" size="sm">
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </form>
  );
}
