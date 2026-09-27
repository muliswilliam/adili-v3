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
import type { Organisation } from './organisation';
import { platformRoles, roleLabel } from './roles';

export function IdentityCard({
  user,
  directory,
  organisation,
}: {
  user: SessionUser;
  directory: PrincipalResult;
  organisation: Organisation;
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
                <OrganisationName organisation={organisation} />
              </DescriptionItem>
              <DescriptionItem term="Roles">
                <span className="flex flex-wrap gap-1.5">
                  {platformRoles(directory.principal.roles).map((role) => (
                    <Badge key={role}>{roleLabel(role)}</Badge>
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

function OrganisationName({ organisation }: { organisation: Organisation }) {
  switch (organisation.kind) {
    case 'commission':
      return (
        <span className="grid gap-0.5">
          <span>{organisation.name}</span>
          <span className="font-mono text-xs text-muted-foreground uppercase">
            {organisation.key}
          </span>
        </span>
      );
    case 'platform':
      return <span>Adili Online platform team</span>;
    case 'key-only':
      // The directory did not return the Commission's name; its key still identifies it.
      return <span className="font-mono text-[13px] uppercase">{organisation.key}</span>;
    case 'none':
      return <span className="text-muted-foreground">Not assigned</span>;
  }
}
