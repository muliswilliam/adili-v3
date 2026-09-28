import { Alert, AlertDescription, AlertTitle, Button, Icon } from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { Link, notFound, redirect } from '@tanstack/react-router';

import type { PersonKey } from '../../declaration/contents';
import { isUuid, parsePersonKey, statementSectionKey } from '../../declaration/section-key';
import { getDeclarationSection } from '../../server/declarations';
import type { SectionResult } from '../../server/declarations.server';
import type { SectionKey } from '../../server/declarations/types';
import { loginHref } from '../sign-in';

/** Helpers for the workspace's route files, so each section route stays a few lines. */

/** Throws the router's not-found for a malformed declaration id. */
export function requireDeclarationId(id: string): string {
  if (!isUuid(id)) throw notFound();
  return id;
}

/** Throws the router's not-found for a statement route's malformed person key. */
export function requirePersonKey(personKey: string): PersonKey {
  const parsed = parsePersonKey(personKey);
  if (!parsed) throw notFound();
  return parsed;
}

/** `officer`, `spouse:<uuid>` or `child:<uuid>` from the statement route, as a section key. */
export function statementKey(personKey: string): SectionKey {
  return statementSectionKey(requirePersonKey(personKey));
}

/** The redirect to sign in, then back to `returnTo`, as a full page load (see `loginHref`). */
export function signInRedirect(returnTo: string) {
  return redirect({ href: loginHref(returnTo), reloadDocument: true });
}

type Settled<T> = Exclude<T, { status: 'unauthenticated' | 'not-found' }>;

/**
 * What a workspace loader does with a server function's result: signs the declarant in when
 * the session has ended (then back to `returnTo`), 404s for what the service does not have,
 * and returns anything else.
 */
export function settleLoad<T extends { status: string }>(result: T, returnTo: string): Settled<T> {
  if (result.status === 'unauthenticated') throw signInRedirect(returnTo);
  if (result.status === 'not-found') throw notFound();
  return result as Settled<T>;
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
  return settleLoad(result, returnTo);
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
