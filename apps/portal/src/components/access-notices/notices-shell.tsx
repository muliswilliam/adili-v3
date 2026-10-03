import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  EmptyState,
  Icon,
  SiteFooter,
  SiteHeader,
  ToastProvider,
  TooltipProvider,
} from '@adili/ui';
import { AlertCircleIcon, ArrowLeft01Icon, SearchList01Icon } from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { NOTICE_COPY as COPY } from '../../access/notice-copy';
import { SignOutButton } from '../sign-out-button';
import { HelpLink } from '../help/parts';

/** The declarant's chrome around the access request pages: header, toasts, footer. */
export function NoticesShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TooltipProvider>
        <SiteHeader
          actions={
            <>
              <HelpLink />
              <SignOutButton />
            </>
          }
        />
        {children}
        <SiteFooter />
      </TooltipProvider>
    </ToastProvider>
  );
}

function BackToList() {
  return (
    <Button asChild variant="ghost" size="sm" className="justify-self-start">
      <Link to="/access/notices" search={{}}>
        <Icon icon={ArrowLeft01Icon} />
        {COPY.back}
      </Link>
    </Button>
  );
}

/** A request that is not about the declarant, or no request at all. */
export function NoticeNotFound() {
  return (
    <main className="mx-auto grid w-full max-w-[880px] flex-1 content-start gap-3 px-4 pt-5 pb-16 sm:px-7 sm:pt-8">
      <BackToList />
      <Card>
        <EmptyState
          className="py-14"
          icon={<Icon icon={SearchList01Icon} />}
          title={COPY.notFoundTitle}
          description={COPY.notFoundText}
          action={
            <Button asChild variant="secondary">
              <Link to="/access/notices" search={{}}>
                {COPY.allRequests}
              </Link>
            </Button>
          }
        />
      </Card>
    </main>
  );
}

/** The access service could not be reached: say so, with Try again. */
export function UnavailableAlert({ title, text }: { title: string; text: string }) {
  const router = useRouter();
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-2.5">
        <p>{text}</p>
        <Button variant="secondary" size="sm" onClick={() => void router.invalidate()}>
          {COPY.tryAgain}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** A request's page when the access service could not be reached. */
export function NoticeUnavailable() {
  return (
    <main className="mx-auto grid w-full max-w-[880px] flex-1 content-start gap-3 px-4 pt-5 pb-16 sm:px-7 sm:pt-8">
      <BackToList />
      <UnavailableAlert title={COPY.unavailableTitle} text={COPY.unavailableText} />
    </main>
  );
}
