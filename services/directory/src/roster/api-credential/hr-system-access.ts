import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  type AuthenticatedRequest,
  type Principal,
  ProblemException,
  RateLimit,
  Scopes,
} from '@adili/api-kit';
import { type createValkey, InjectValkey } from '@adili/cache';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { config } from '../../config.js';
import type { DirectorySchema } from '../../db/schema.js';
import { ROSTER_WRITE_SCOPE } from './representation.js';
import { rosterApiCredentials } from './schema.js';

/** Rate limit groups of the roster API: writes (imports, exits) and reads. */
export type RosterApiGroup = 'roster-write' | 'roster-read';

/** `lastUsedAt` moves at most this often per credential. */
const LAST_USED_THROTTLE_SECONDS = 60;

/**
 * Opens a route to Commissions' HR systems (tokens with `roster:write`) besides the roles the
 * route names with `@Roles`, and rate limits every caller of it per client (`group`, ADR-009):
 * every response carries `RateLimit-*` headers, and 429 past the limit.
 *
 * An HR system's token is accepted only while the credential it was issued for is current: its
 * client is the tenant's credential, not revoked, and not rotated after the token was issued
 * (`ApiCredentialGuard`; a token issued in the second of the rotation counts as issued before
 * it), so revoking or rotating takes effect at once rather than when the token expires. Put it below `@Roles`, so the rate limit and the credential check run first.
 *
 * @example
 * @Post()
 * @Roles(REPORTING_OFFICER)
 * @HrSystemAccess('roster-write')
 * start() {}
 */
export const HrSystemAccess = (group: RosterApiGroup) => {
  const policy = config.RATE_LIMITS[group];
  return applyDecorators(
    RateLimit(group),
    UseGuards(ApiCredentialGuard),
    Scopes(ROSTER_WRITE_SCOPE),
    ApiProblemResponse(
      HttpStatus.UNAUTHORIZED,
      "Missing, expired or invalid access token. Problem type `credential-not-current`: the HR system's credential was revoked, or its secret rotated after the token was issued",
    ),
    ApiExtension('x-rate-limit', {
      group,
      limit: policy?.limit,
      windowSeconds: policy?.windowSeconds,
      description: `Per client: up to ${policy?.limit} requests per ${policy?.windowSeconds} seconds by default (a token bucket shared by the routes of the group). Every response carries RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset; past the limit, 429 with Retry-After.`,
    }),
  );
};

/** Whether `principal` is an HR system: a client-credentials token with `roster:write`. */
export function isHrSystem(principal: Principal): boolean {
  return principal.scopes.includes(ROSTER_WRITE_SCOPE);
}

/**
 * Accepts an HR system's token only while its credential is current (see `HrSystemAccess`), and
 * records that the credential was used (`lastUsedAt`, at most once a minute per client, throttled
 * in Valkey). Other callers pass untouched. Refusals are 401: the token no longer authenticates.
 */
@Injectable()
export class ApiCredentialGuard implements CanActivate {
  private readonly logger = new Logger(ApiCredentialGuard.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    @InjectValkey() private readonly valkey: ReturnType<typeof createValkey>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { principal } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!principal || !isHrSystem(principal)) return true;
    const { tenant, clientId, issuedAt } = principal;
    if (!tenant || !clientId || issuedAt === null) throw notCurrent();

    const current = and(
      eq(rosterApiCredentials.tenant, tenant),
      eq(rosterApiCredentials.keycloakClientId, clientId),
      isNull(rosterApiCredentials.revokedAt),
      // `iat` has whole seconds, so a token issued in the second of the rotation may be of the
      // old secret: only tokens issued in a later second are accepted.
      sql`(${rosterApiCredentials.rotatedAt} is null or ${issuedAt} > floor(extract(epoch from ${rosterApiCredentials.rotatedAt})))`,
    );
    await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [found] = await tx
        .select({ tenant: rosterApiCredentials.tenant })
        .from(rosterApiCredentials)
        .where(current);
      if (!found) throw notCurrent();
      if (await this.dueForBump(clientId)) {
        await tx
          .update(rosterApiCredentials)
          .set({ lastUsedAt: sql`now()` })
          .where(eq(rosterApiCredentials.tenant, tenant));
      }
    });
    return true;
  }

  /**
   * True at most once per throttle window per client. When Valkey is down the credential is
   * still checked, but `lastUsedAt` is left alone rather than written on every request.
   */
  private async dueForBump(clientId: string): Promise<boolean> {
    try {
      const set = await this.valkey.set(
        `roster-api-credential-used:${clientId}`,
        '1',
        'EX',
        LAST_USED_THROTTLE_SECONDS,
        'NX',
      );
      return set === 'OK';
    } catch (error) {
      this.logger.warn({ err: error }, 'Valkey unavailable; lastUsedAt not updated');
      return false;
    }
  }
}

function notCurrent(): ProblemException {
  return new ProblemException({
    type: 'credential-not-current',
    title: 'Unauthorized',
    status: HttpStatus.UNAUTHORIZED,
    detail:
      "The token's API credential was revoked or its secret rotated after the token was issued. Get a new token with the current credential.",
  });
}
