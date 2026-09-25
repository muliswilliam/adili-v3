import { EmptyState, Icon } from '@adili/ui';
import { SquareLock02Icon } from '@hugeicons/core-free-icons';

export function NoStaffRoles() {
  return (
    <EmptyState
      icon={<Icon icon={SquareLock02Icon} />}
      title="No staff roles"
      text="Your account has no console access. Declarants file through the portal."
      className="rounded-lg"
    />
  );
}
