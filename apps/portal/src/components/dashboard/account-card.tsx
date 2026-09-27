import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardIcon,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  formatDate,
  Icon,
  MaskedContact,
  OfficerReference,
} from '@adili/ui';
import { AlertCircleIcon, SecurityCheckIcon, UserCheck01Icon } from '@hugeicons/core-free-icons';

import type { DeclarantAccount } from '../../server/declarant.server';

/** "Your account" for an onboarded declarant: Commission, OFR to copy, verified contacts. */
export function DeclarantCard({ account }: { account: DeclarantAccount }) {
  const multipleCommissions = account.commissions.length > 1;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <CardIcon className="mb-0 bg-success-subtle text-success">
          <Icon icon={UserCheck01Icon} />
        </CardIcon>
        <div className="grid min-w-0 gap-0.5">
          <CardTitle>Your account</CardTitle>
          <CardDescription className="truncate">{account.fullName}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          <DescriptionItem
            term={multipleCommissions ? 'Responsible Commissions' : 'Responsible Commission'}
          >
            {multipleCommissions ? (
              <ul className="grid gap-0.5">
                {account.commissions.map((commission) => (
                  <li key={commission.slug}>{commission.name}</li>
                ))}
              </ul>
            ) : (
              (account.commissions[0]?.name ?? null)
            )}
          </DescriptionItem>
          <DescriptionItem term="Officer reference" className="items-center">
            <OfficerReference value={account.ofr} />
          </DescriptionItem>
          <DescriptionItem term="Email">
            <Contact kind="email" value={account.maskedEmail} />
          </DescriptionItem>
          <DescriptionItem term="Phone">
            <Contact kind="phone" value={account.maskedPhone} />
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
      <CardFooter className="mt-5 flex-nowrap items-start gap-2 border-t text-[13.5px] text-muted-foreground">
        <Icon icon={SecurityCheckIcon} className="mt-px size-4 shrink-0" aria-hidden="true" />
        <ul className="grid gap-0.5">
          {account.commissions.map((commission) => (
            <li key={commission.slug}>
              {multipleCommissions
                ? `Onboarded at ${commission.name} on ${formatDate(commission.onboardedAt)}`
                : `Onboarded on ${formatDate(commission.onboardedAt)}`}
            </li>
          ))}
        </ul>
      </CardFooter>
    </Card>
  );
}

function Contact({ kind, value }: { kind: 'email' | 'phone'; value: string | null }) {
  if (value === null) {
    return <span className="font-normal text-muted-foreground">Not provided</span>;
  }
  return <MaskedContact kind={kind} value={value} verified className="justify-end" />;
}

/** `GET /v1/me/declarant` failed for another reason than 404. */
export function DeclarantUnavailableCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your account</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert variant="warning">
          <Icon icon={AlertCircleIcon} />
          <AlertTitle>Account details unavailable</AlertTitle>
          <AlertDescription>
            Your Commission and officer reference could not be loaded. Please try again shortly.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
