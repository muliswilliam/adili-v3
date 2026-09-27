import { Button, Icon } from '@adili/ui';
import { Logout01Icon } from '@hugeicons/core-free-icons';

/** A form POST so logout cannot be triggered by a cross-site link. */
export function SignOutButton() {
  return (
    <form method="post" action="/auth/logout">
      <Button type="submit" variant="secondary" size="sm">
        <Icon icon={Logout01Icon} />
        Sign out
      </Button>
    </form>
  );
}
