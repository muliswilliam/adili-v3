import { getRequest } from '@tanstack/react-start/server';

import { type AccessClient, accessClient } from './access/client.server';
import { getBff } from './bff.server';
import {
  createDirectoryClient,
  type DirectoryClient,
  type DirectoryResult,
} from './directory/client';
import {
  createDeclarationsClient,
  type DeclarationsClient,
  type DeclarationsResult,
} from './declarations/client';
import {
  createDocumentsClient,
  type DocumentsClient,
  type DocumentsResult,
} from './documents/client';
import { env } from './env.server';
import {
  createIntegrationGatewayClient,
  type IntegrationGatewayClient,
  type IntegrationGatewayResult,
} from './integration-gateway/client';
import { reportingClient, type ReportingClient } from './reporting/client.server';
import { reviewClient, type ReviewClient } from './review/client.server';
import type { ServiceResult } from './service-call';

/** The answer for a request without a signed-in user; every service result type has it. */
export interface Unauthenticated {
  ok: false;
  error: { kind: 'unauthenticated' };
}

/**
 * Runs `work` with a service client that `createClient` makes for the signed-in user's access
 * token, or answers `unauthenticated` without calling it when there is no session.
 */
export async function withViewerClient<Client, Result>(
  createClient: (accessToken: string) => Client,
  work: (client: Client) => Promise<Result>,
): Promise<Result | Unauthenticated> {
  const session = await getBff().getSession(getRequest());
  if (!session) {
    return { ok: false, error: { kind: 'unauthenticated' } };
  }
  return work(createClient(session.accessToken));
}

/**
 * Runs `work` with an access client acting as the signed-in user: the access officer or
 * supervisor of the Form K, law enforcement and certified copy screens, or a law enforcement
 * officer.
 */
export function asAccessViewer<Result>(
  work: (client: AccessClient) => Promise<Result>,
): Promise<Result | Unauthenticated> {
  return withViewerClient(accessClient, work);
}

/**
 * Runs `work` with a reporting client acting as the signed-in user: the supervisor,
 * commission-admin or reporting officer of the Form M workspace.
 */
export function asReportingViewer<Result>(
  work: (client: ReportingClient) => Promise<Result>,
): Promise<Result | Unauthenticated> {
  return withViewerClient(reportingClient, work);
}

/** Runs `work` with a directory client acting as the signed-in user. */
export function asViewer<T>(
  work: (client: DirectoryClient) => Promise<DirectoryResult<T>>,
): Promise<DirectoryResult<T>> {
  return withViewerClient(
    (accessToken) => createDirectoryClient({ baseUrl: env().DIRECTORY_API_URL, accessToken }),
    work,
  );
}

/** Runs `work` with a documents client acting as the signed-in user. */
export function asDocumentsViewer<T>(
  work: (client: DocumentsClient) => Promise<DocumentsResult<T>>,
): Promise<DocumentsResult<T>> {
  return withViewerClient(
    (accessToken) => createDocumentsClient({ baseUrl: env().DOCUMENTS_API_URL, accessToken }),
    work,
  );
}

/** Runs `work` with a declarations client acting as the signed-in user. */
export function asDeclarationsViewer<T>(
  work: (client: DeclarationsClient) => Promise<DeclarationsResult<T>>,
): Promise<DeclarationsResult<T>> {
  return withViewerClient(
    (accessToken) => createDeclarationsClient({ baseUrl: env().DECLARATIONS_API_URL, accessToken }),
    work,
  );
}

/** Runs `work` with an integration-gateway client acting as the signed-in user. */
export function asIntegrationGatewayViewer<T>(
  work: (client: IntegrationGatewayClient) => Promise<IntegrationGatewayResult<T>>,
): Promise<IntegrationGatewayResult<T>> {
  return withViewerClient(
    (accessToken) =>
      createIntegrationGatewayClient({ baseUrl: env().INTEGRATION_GATEWAY_API_URL, accessToken }),
    work,
  );
}

/** Who is signed in, as the review service's callers need it. */
export interface SignedInReviewer {
  subject: string;
  name: string;
  accessToken: string;
}

/**
 * Runs `work` with a review client acting as the signed-in reviewer (or supervisor, or
 * commission admin), and who that is (their token stays on the server); `signedOut()` without
 * calling it when there is no session.
 */
export async function withReviewer<R>(
  work: (client: ReviewClient, viewer: SignedInReviewer) => Promise<R>,
  signedOut: () => R,
): Promise<R> {
  const session = await getBff().getSession(getRequest());
  if (!session) return signedOut();
  const { accessToken } = session;
  return work(reviewClient(accessToken), {
    subject: session.user.subject,
    name: session.user.name,
    accessToken,
  });
}

/** `withReviewer` for a service call: `unauthenticated` without a session. */
export function asReviewer<T>(
  work: (client: ReviewClient, viewer: SignedInReviewer) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  return withReviewer(work, () => ({ ok: false, error: { kind: 'unauthenticated' } }));
}
