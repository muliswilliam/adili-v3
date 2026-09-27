import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardIcon,
  CardTitle,
  CopyButton,
  DescriptionItem,
  DescriptionList,
  Icon,
  MaskedContact,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  SecurityCheckIcon,
  UserCheck01Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type { DeclarantAccount } from '../../server/declarant.server';
import { formatDate } from './format-date';

/** "Your account" for an onboarded declarant: Commission, OFR to copy, verified contacts. */
export function DeclarantCard({ account }: { account: DeclarantAccount }) {
  const several = account.commissions.length > 1;
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
          <DescriptionItem term={several ? 'Responsible Commissions' : 'Responsible Commission'}>
            {several ? (
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
            <span className="inline-flex items-center gap-1">
              <span className="font-mono font-semibold tracking-[0.02em]">{account.ofr}</span>
              <CopyButton
                value={account.ofr}
                label="Copy officer reference"
                copiedMessage="Officer reference copied"
                className="-my-1.5"
              />
            </span>
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
              {several
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

/**
 * The signed-in user has no onboarded roster record (`GET /v1/me/declarant` answered 404), so
 * there is nothing to declare yet. Points public officers to Get started.
 */
export function NotDeclarantCard() {
  return (
    <Card>
      <CardHeader>
        <CardIcon>
          <Icon icon={UserRemove01Icon} />
        </CardIcon>
        <CardTitle>You are not onboarded as a declarant</CardTitle>
        <CardDescription>
          This account is not linked to any Commission's roster, so you have no declarations to make
          here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          If you are a public officer, get started with your personnel file number and national ID.
          If you have done that and still see this, contact your Commission's reporting officer.
        </p>
      </CardContent>
      <CardFooter>
        <Button asChild variant="secondary">
          <Link to="/get-started">
            Get started
            <Icon icon={ArrowRight01Icon} />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
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
