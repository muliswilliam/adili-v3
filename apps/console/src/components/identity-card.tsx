import type { SessionUser } from '@adili/bff-auth';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  Icon,
} from '@adili/ui';
import { AlertCircleIcon, SecurityCheckIcon } from '@hugeicons/core-free-icons';

import type { PrincipalResult } from '../server/directory.server';

export function IdentityCard({
  user,
  directory,
}: {
  user: SessionUser;
  directory: PrincipalResult;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="grid gap-1.5">
          <CardTitle>Your account</CardTitle>
          <CardDescription>As verified by the platform from your sign-in.</CardDescription>
        </div>
        {directory.ok ? (
          <Badge>
            <Icon icon={SecurityCheckIcon} className="size-3.5" />
            Verified
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-5">
        <DescriptionList>
          <DescriptionItem term="Name">{user.name}</DescriptionItem>
          {user.username ? (
            <DescriptionItem term="Username">{user.username}</DescriptionItem>
          ) : null}
          {user.email ? <DescriptionItem term="Email">{user.email}</DescriptionItem> : null}
          {directory.ok ? (
            <>
              <DescriptionItem term="Organisation">
                {directory.principal.tenant ? (
                  <span className="font-mono text-[13px] uppercase">
                    {directory.principal.tenant}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not assigned</span>
                )}
              </DescriptionItem>
              <DescriptionItem term="Roles">
                <span className="flex flex-wrap gap-1.5">
                  {platformRoles(directory.principal.roles).map((role) => (
                    <Badge key={role}>{role}</Badge>
                  ))}
                </span>
              </DescriptionItem>
            </>
          ) : null}
        </DescriptionList>
        {directory.ok ? null : (
          <Alert variant="warning">
            <Icon icon={AlertCircleIcon} />
            <AlertTitle>Account details unavailable</AlertTitle>
            <AlertDescription>{directory.reason}. Please try again shortly.</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/** Hides Keycloak's built-in roles, which mean nothing to users. */
export function platformRoles(roles: readonly string[]): string[] {
  return roles.filter(
    (role) =>
      role !== 'offline_access' &&
      role !== 'uma_authorization' &&
      !role.startsWith('default-roles-'),
  );
}
