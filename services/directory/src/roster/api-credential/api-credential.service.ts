import { randomBytes } from 'node:crypto';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { config } from '../../config.js';
import { commissions, type DirectorySchema } from '../../db/schema.js';
import {
  ApiClientNotFound,
  IdentityProvisioning,
  IdentityUnavailable,
} from '../../identity/identity-provisioning.js';
import { type ApiCredentialAction, apiCredentialChanged } from './events.js';
import {
  ROSTER_WRITE_SCOPE,
  type RosterApiCredential,
  type RosterApiCredentialWithSecret,
} from './representation.js';
import { rosterApiCredentials } from './schema.js';

type CredentialRow = typeof rosterApiCredentials.$inferSelect;

/**
 * A Commission's HR-system credential (spec #27): an API client in the identity provider whose
 * tokens carry `roster:write` and the Commission's tenant, and its metadata here. The secret is
 * returned once, when created or rotated, and never stored.
 *
 * Each change calls the identity provider inside the transaction that holds the credential's
 * row, so changes to one Commission's credential run one at a time and the metadata commits only
 * when the identity provider made the change. A created client whose metadata then fails to
 * commit is disabled again, so no usable client exists without a credential.
 */
@Injectable()
export class ApiCredentialService {
  private readonly logger = new Logger(ApiCredentialService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
    private readonly identity: IdentityProvisioning,
  ) {}

  /** The credential's metadata, revoked or not, or null when none was ever created. */
  get(principal: Principal, slug: string): Promise<RosterApiCredential | null> {
    return this.inTenant(principal, slug, async (tx) => {
      const [row] = await tx
        .select()
        .from(rosterApiCredentials)
        .where(eq(rosterApiCredentials.tenant, slug));
      return row ? toCredential(row) : null;
    });
  }

  /**
   * Creates the API client and records its metadata with `created`. 409 while a credential that
   * is not revoked exists; after a revocation, the new credential replaces the revoked one.
   */
  async create(principal: Principal, slug: string): Promise<RosterApiCredentialWithSecret> {
    const clientId = newClientId(slug);
    let issued: { row: CredentialRow; secret: string } | undefined;
    try {
      return await this.inTenant(principal, slug, async (tx) => {
        await this.requireCommission(tx, slug);
        const row = await this.claim(tx, principal, slug, clientId);
        const { secret } = await this.identity.createApiClient({
          tenant: slug,
          clientId,
          scopes: [ROSTER_WRITE_SCOPE],
        });
        issued = { row, secret };
        await this.record(tx, slug, 'created', clientId);
        return withSecret(row, secret);
      });
    } catch (error) {
      if (issued) {
        // Created in the identity provider, but the metadata did not commit.
        await this.identity.disableApiClient(clientId).catch((undo: unknown) => {
          this.logger.error(`Could not disable API client ${clientId} after a failed create`, undo);
        });
      }
      throw asProblem(error, 'The identity provider did not respond, so nothing was created.');
    }
  }

  /** Issues a new secret for the active credential and records `rotated`. 404 when none. */
  async rotate(principal: Principal, slug: string): Promise<RosterApiCredentialWithSecret> {
    try {
      return await this.inTenant(principal, slug, async (tx) => {
        const current = await this.active(tx, slug);
        const { secret } = await this.identity.rotateApiClientSecret(current.keycloakClientId);
        const [row] = await tx
          .update(rosterApiCredentials)
          .set({ rotatedAt: sql`now()` })
          .where(eq(rosterApiCredentials.tenant, slug))
          .returning();
        await this.record(tx, slug, 'rotated', current.keycloakClientId);
        return withSecret(row ?? current, secret);
      });
    } catch (error) {
      throw asProblem(
        error,
        'The identity provider did not respond, so the secret was not rotated and the current one still works.',
      );
    }
  }

  /** Disables the active credential's client and records `revoked`. 404 when none. */
  async revoke(principal: Principal, slug: string): Promise<void> {
    try {
      await this.inTenant(principal, slug, async (tx) => {
        const current = await this.active(tx, slug);
        await this.identity.disableApiClient(current.keycloakClientId);
        await tx
          .update(rosterApiCredentials)
          .set({ revokedAt: sql`now()` })
          .where(eq(rosterApiCredentials.tenant, slug));
        await this.record(tx, slug, 'revoked', current.keycloakClientId);
      });
    } catch (error) {
      throw asProblem(
        error,
        'The identity provider did not respond, so access was not revoked. Try again.',
      );
    }
  }

  /**
   * Runs `work` in the Commission's RLS context. The credential is the Commission's own: other
   * tenants get 404, as if it did not exist.
   */
  private inTenant<T>(
    principal: Principal,
    slug: string,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    notFoundIfInvisible(slug, () => principal.tenant === slug);
    return withTenant(this.db, { tenant: slug, subject: principal.subject }, work);
  }

  private async requireCommission(tx: Transaction, slug: string): Promise<void> {
    const [commission] = await tx
      .select({ slug: commissions.slug })
      .from(commissions)
      .where(eq(commissions.slug, slug));
    notFoundIfInvisible(commission);
  }

  /**
   * Writes the new credential's row, replacing a revoked one, and holds it until the commit. A
   * concurrent create waits for this one, then finds an active credential. 409 when one exists.
   */
  private async claim(
    tx: Transaction,
    principal: Principal,
    slug: string,
    clientId: string,
  ): Promise<CredentialRow> {
    const values = {
      keycloakClientId: clientId,
      createdBy: principal.subject,
      createdByName: principal.name,
      createdAt: sql`now()`,
      rotatedAt: null,
      revokedAt: null,
      lastUsedAt: null,
    };
    const [row] = await tx
      .insert(rosterApiCredentials)
      .values({ tenant: slug, ...values })
      .onConflictDoUpdate({
        target: rosterApiCredentials.tenant,
        set: values,
        setWhere: isNotNull(rosterApiCredentials.revokedAt),
      })
      .returning();
    if (!row) {
      throw new ProblemException({
        type: 'api-credential-exists',
        title: 'API credential exists',
        status: HttpStatus.CONFLICT,
        detail: 'This Commission already has API credentials. Rotate the secret or revoke access.',
      });
    }
    return row;
  }

  /** The credential that is not revoked, locked until the commit; 404 when there is none. */
  private async active(tx: Transaction, slug: string): Promise<CredentialRow> {
    const [row] = await tx
      .select()
      .from(rosterApiCredentials)
      .where(and(eq(rosterApiCredentials.tenant, slug), isNull(rosterApiCredentials.revokedAt)))
      .for('update');
    return notFoundIfInvisible(row);
  }

  private async record(
    tx: Transaction,
    slug: string,
    action: ApiCredentialAction,
    clientId: string,
  ): Promise<void> {
    await this.events.record(tx, apiCredentialChanged(slug, { action, clientId }));
  }
}

/** A client id no other credential had: a new credential needs new configuration anyway. */
function newClientId(slug: string): string {
  return `roster-${slug}-${randomBytes(4).toString('hex')}`;
}

function toCredential(row: CredentialRow): RosterApiCredential {
  return {
    clientId: row.keycloakClientId,
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdBy, name: row.createdByName },
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function withSecret(row: CredentialRow, secret: string): RosterApiCredentialWithSecret {
  return {
    ...toCredential(row),
    secret,
    tokenEndpoint: `${config.OIDC_ISSUER_URL.replace(/\/$/, '')}/protocol/openid-connect/token`,
    scope: ROSTER_WRITE_SCOPE,
  };
}

/** Maps identity failures to the problem the caller receives; others pass through. */
function asProblem(error: unknown, unavailable: string): unknown {
  if (error instanceof IdentityUnavailable) {
    return new ProblemException({
      type: 'identity-unavailable',
      title: 'Identity provider unavailable',
      status: HttpStatus.BAD_GATEWAY,
      detail: unavailable,
    });
  }
  if (error instanceof ApiClientNotFound) {
    return new ProblemException({
      type: 'api-credential-client-missing',
      title: 'API client missing',
      status: HttpStatus.CONFLICT,
      detail:
        "The credential's client no longer exists in the identity provider. Revoke access and create new credentials.",
    });
  }
  return error;
}
