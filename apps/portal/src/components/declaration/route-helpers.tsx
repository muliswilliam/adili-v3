import { Alert, AlertDescription, AlertTitle, Button, Icon } from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { Link, notFound, redirect } from '@tanstack/react-router';

import { parsePersonKey, statementSectionKey } from '../../declaration/section-key';
import { getDeclarationSection } from '../../server/declarations';
import type { SectionResult } from '../../server/declarations.server';
import type { SectionKey } from '../../server/declarations/types';

/** Helpers for the workspace's route files, so each section route stays a few lines. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Throws the router's not-found for a malformed declaration id. */
export function requireDeclarationId(id: string): string {
  if (!UUID.test(id)) throw notFound();
  return id;
}

/** `officer`, `spouse:<uuid>` or `child:<uuid>` from the statement route, as a section key. */
export function statementKey(personKey: string): SectionKey {
  const parsed = parsePersonKey(personKey);
  if (!parsed) throw notFound();
  return statementSectionKey(parsed);
}

export function loginHref(returnTo: string) {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * The redirect to sign in, then back to `returnTo`. `/auth/login` is a server route, so it
 * must be a full page load: on in-app navigation the browser router would render Not Found.
 */
export function signInRedirect(returnTo: string) {
  return redirect({ href: loginHref(returnTo), reloadDocument: true });
}

export type SectionLoad = Extract<SectionResult, { status: 'ok' | 'unavailable' }>;

/**
 * Loader for a section route: fetches the section fresh (the service's cache is server-side
 * only), signs the declarant in when the session has ended, and 404s for a section the draft
 * does not have.
 */
export async function loadSectionFor(
  declarationId: string,
  sectionKey: SectionKey,
  returnTo: string,
): Promise<SectionLoad> {
  const result = await getDeclarationSection({
    data: { declarationId: requireDeclarationId(declarationId), sectionKey },
  });
  if (result.status === 'unauthenticated') throw signInRedirect(returnTo);
  if (result.status === 'not-found') throw notFound();
  return result;
}

/** A section could not be loaded because the service is down. */
export function SectionUnavailable() {
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>We could not load this section</AlertTitle>
      <AlertDescription>
        Your saved work is safe. Reload the page, or try again in a few minutes.
      </AlertDescription>
    </Alert>
  );
}

/** Shown for a declaration or section that does not exist or is not yours. */
export function DeclarationNotFound() {
  return (
    <div className="mx-auto grid w-full max-w-xl flex-1 content-start gap-4 px-4 py-16 text-center">
      <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Declaration not found</h1>
      <p className="text-muted-foreground">
        It may have been discarded, or the link is wrong. Your declarations are on your dashboard.
      </p>
      <Button asChild variant="secondary" className="justify-self-center">
        <Link to="/">Go to your dashboard</Link>
      </Button>
    </div>
  );
}

/** Placeholder body for a section whose screen is not built yet. */
export function SectionComingSoon() {
  return (
    <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
      This section is not available yet.
    </p>
  );
}
