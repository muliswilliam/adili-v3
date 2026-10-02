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
  cn,
  DescriptionItem,
  DescriptionList,
  focusRingInset,
  formatDate,
  Icon,
  MaskedContact,
  OfficerReference,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  SecurityCheckIcon,
  Stamp01Icon,
  UserCheck01Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

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
      <nav aria-label="Transparency" className="mt-4 grid border-t">
        <AccountLink to="/access/history" icon={ViewIcon}>
          Who accessed my declaration
        </AccountLink>
        <AccountLink to="/access/certified-copies" icon={Stamp01Icon}>
          Certified copies
        </AccountLink>
      </nav>
      <CardFooter className="flex-nowrap items-start gap-2 text-[13.5px] text-muted-foreground">
        <Icon icon={SecurityCheckIcon} className="mt-px size-4 shrink-0" aria-hidden="true" />
        <ul className="grid gap-0.5">
          {account.commissions.map((commission) => {
            // No-break spaces keep the date whole when the line wraps.
            const date = formatDate(commission.onboardedAt).replaceAll(' ', '\u00A0');
            return (
              <li key={commission.slug}>
                {multipleCommissions
                  ? `Onboarded at ${commission.name} on ${date}`
                  : `Onboarded on ${date}`}
              </li>
            );
          })}
        </ul>
      </CardFooter>
    </Card>
  );
}

/** A row to one of the declarant's transparency pages (spec 10 FE-4). */
function AccountLink({
  to,
  icon,
  children,
}: {
  to: '/access/history' | '/access/certified-copies';
  icon: typeof ViewIcon;
  children: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        focusRingInset,
        '-mx-5 flex items-center gap-3 border-b px-5 py-3 text-[14.5px] font-medium transition-colors hover:bg-muted/50 sm:-mx-6 sm:px-6',
      )}
    >
      <Icon icon={icon} className="size-[18px] text-muted-foreground" />
      <span className="flex-1">{children}</span>
      <Icon icon={ArrowRight01Icon} className="size-4 text-muted-foreground" />
    </Link>
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
