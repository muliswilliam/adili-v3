import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  mixin,
  type Type,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { ApiProblemResponse, type AuthenticatedRequest, ProblemException } from '@adili/api-kit';

import type { InstructionLegalBasis, LegalBasis } from '../db/schema.js';
import type { LookupContext, LookupPurpose } from './registry-adapter.js';

export const LEGAL_BASIS_HEADER = 'x-legal-basis';
export const CASE_REF_HEADER = 'x-case-ref';
export const SUBJECT_PERSON_HEADER = 'x-subject-person';

/** A case reference as callers send it: an id or printed reference, never free text. */
const CASE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PurposeRequest = AuthenticatedRequest & {
  lookupPurpose?: LookupPurpose;
  instructionPurpose?: InstructionPurpose;
};

/** Why an instruction (an act on a system, not a read) is sent, as the calling service declares it. */
export interface InstructionPurpose {
  legalBasis: InstructionLegalBasis;
  /** The review case (or other record) the instruction is for; null when there is none. */
  caseRef: string | null;
}

/** The services that call the lookups which take `X-Legal-Basis`, by OAuth client (`azp`). */
type LookupClient = 'review' | 'declarations';

/**
 * The legal bases a caller may name in `X-Legal-Basis` (`HEADER_LEGAL_BASES`), each with the one
 * service whose work it is: review cross-checks and verifies declarations; the declarations service
 * looks up on the declarant's own request (spec 05b story 17: no lookup beyond the legal basis).
 * Both hold the `registry` scope, so neither may borrow the other's basis. Onboarding's
 * `adr-014-onboarding` is not named in a header: the IPRS route records it itself.
 */
const CLIENT_OF_BASIS = {
  'regs-r20-1-b': 'review',
  'act-s35-5': 'review',
  'declarant-request': 'declarations',
} as const satisfies Partial<Record<LegalBasis, LookupClient>>;
type HeaderLegalBasis = keyof typeof CLIENT_OF_BASIS;
const HEADER_LEGAL_BASES = Object.keys(CLIENT_OF_BASIS) as HeaderLegalBasis[];

function isHeaderLegalBasis(value: string): value is HeaderLegalBasis {
  return Object.hasOwn(CLIENT_OF_BASIS, value);
}

export interface LookupPurposeOptions {
  /** The lookup is for a case: `X-Case-Ref` is required (spec 07b's registry lookups). */
  caseRef?: 'required';
}

/**
 * Reads why a lookup is made from `X-Legal-Basis` (required, one of `HEADER_LEGAL_BASES`) and
 * `X-Case-Ref` (optional unless `caseRef: 'required'`), and whom it is about from
 * `X-Subject-Person` (optional). Missing or malformed headers are a 400 problem naming the header.
 */
export function parseLookupPurpose(
  headers: PurposeRequest['headers'],
  options: LookupPurposeOptions = {},
): LookupPurpose & { legalBasis: HeaderLegalBasis } {
  const legalBasis = single(headers[LEGAL_BASIS_HEADER]);
  if (!legalBasis || !isHeaderLegalBasis(legalBasis)) {
    throw invalid(
      'X-Legal-Basis',
      `Must name the legal basis: one of ${HEADER_LEGAL_BASES.join(', ')}`,
    );
  }
  const caseRef = single(headers[CASE_REF_HEADER]);
  if (caseRef === undefined && options.caseRef === 'required') {
    throw invalid('X-Case-Ref', 'Must name the case the lookup is for');
  }
  if (caseRef !== undefined && !CASE_REF.test(caseRef)) {
    throw invalid('X-Case-Ref', 'Must be an id or reference of at most 100 characters');
  }
  const subjectPersonId = single(headers[SUBJECT_PERSON_HEADER]);
  if (subjectPersonId !== undefined && !UUID.test(subjectPersonId)) {
    throw invalid('X-Subject-Person', 'Must be a person id (uuid)');
  }
  return {
    legalBasis,
    caseRef: caseRef ?? null,
    subjectPersonId: subjectPersonId?.toLowerCase() ?? null,
  };
}

@Injectable()
class LookupPurposeGuard implements CanActivate {
  protected readonly options: LookupPurposeOptions = {};

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PurposeRequest>();
    const purpose = parseLookupPurpose(request.headers, this.options);
    if (request.principal?.clientId !== CLIENT_OF_BASIS[purpose.legalBasis]) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Forbidden',
        status: HttpStatus.FORBIDDEN,
        detail: `Legal basis ${purpose.legalBasis} is not this service's to name.`,
      });
    }
    request.lookupPurpose = purpose;
    return true;
  }
}

@Injectable()
class CaseLookupPurposeGuard extends LookupPurposeGuard {
  protected override readonly options: LookupPurposeOptions = { caseRef: 'required' };
}

/**
 * Requires a lookup route's caller to declare why it looks (ADR-008: legal basis on every
 * lookup), which `@Purpose()` reads, and with `caseRef: 'required'` the case it looks for. A
 * basis is accepted only from the service whose work it is (`CLIENT_OF_BASIS`), else 403.
 * Documents the headers and the 400 (the route's `InternalApi` documents its 403).
 *
 * @example
 * @Post('ntsa/vehicle-lookups')
 * @LookupPurposeHeaders({ caseRef: 'required' })
 * vehicles(@Purpose() purpose: LookupPurpose) {}
 */
export const LookupPurposeHeaders = (options: LookupPurposeOptions = {}) =>
  applyDecorators(
    UseGuards(options.caseRef === 'required' ? CaseLookupPurposeGuard : LookupPurposeGuard),
    ApiHeader({
      name: 'X-Legal-Basis',
      required: true,
      description:
        "Why the registry is consulted, recorded on the result and the audit event. regs-r20-1-b or act-s35-5 (review's), or declarant-request (the declarations service's); another service's basis is 403",
      schema: { type: 'string', enum: HEADER_LEGAL_BASES },
    }),
    ApiHeader({
      name: 'X-Case-Ref',
      required: options.caseRef === 'required',
      description: 'Review case the lookup is for; recorded on the result and the audit event',
      schema: { type: 'string', pattern: CASE_REF.source },
    }),
    ApiHeader({
      name: 'X-Subject-Person',
      required: false,
      description:
        'Platform person the lookup is about (the case declarant); recorded on the result, so reads of it are audited as reads of their data',
      schema: { type: 'string', format: 'uuid' },
    }),
    ApiProblemResponse(
      HttpStatus.BAD_REQUEST,
      options.caseRef === 'required'
        ? 'X-Legal-Basis or X-Case-Ref missing, X-Legal-Basis unknown, or X-Case-Ref or X-Subject-Person malformed'
        : 'X-Legal-Basis missing or unknown, or X-Case-Ref or X-Subject-Person malformed',
    ),
  );

/** The purpose `@LookupPurposeHeaders()` read. */
export const Purpose = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const purpose = context.switchToHttp().getRequest<PurposeRequest>().lookupPurpose;
  if (!purpose) throw new Error('Purpose used on a route without LookupPurposeHeaders()');
  return purpose;
});

/**
 * Who looks, why and for which tenant, on an internal lookup route (`InternalApi(scope)` and
 * `@LookupPurposeHeaders()`): the context `RegistryLookups.lookup` takes.
 */
export const CurrentLookupContext = createParamDecorator(
  (_: unknown, context: ExecutionContext): LookupContext => {
    const request = context.switchToHttp().getRequest<PurposeRequest & { actingTenant?: string }>();
    const { principal: caller, actingTenant: tenant, lookupPurpose: purpose } = request;
    if (!caller || !tenant || !purpose) {
      throw new Error('CurrentLookupContext used on a route without InternalApi() and purpose');
    }
    return { caller, purpose, tenant };
  },
);

/**
 * Reads why an instruction is sent from `X-Legal-Basis` (required, one of `legalBases`: the bases
 * the route's instructions may be sent on) and `X-Case-Ref` (optional). Missing or malformed
 * headers are a 400 problem naming the header.
 */
export function parseInstructionPurpose(
  headers: PurposeRequest['headers'],
  legalBases: readonly InstructionLegalBasis[],
): InstructionPurpose {
  const legalBasis = single(headers[LEGAL_BASIS_HEADER]);
  if (!legalBasis || !(legalBases as readonly string[]).includes(legalBasis)) {
    throw invalid('X-Legal-Basis', `Must name the legal basis: one of ${legalBases.join(', ')}`);
  }
  const caseRef = single(headers[CASE_REF_HEADER]);
  if (caseRef !== undefined && !CASE_REF.test(caseRef)) {
    throw invalid('X-Case-Ref', 'Must be an id or reference of at most 100 characters');
  }
  return { legalBasis: legalBasis as InstructionLegalBasis, caseRef: caseRef ?? null };
}

function instructionPurposeGuard(legalBases: readonly InstructionLegalBasis[]): Type<CanActivate> {
  @Injectable()
  class InstructionPurposeGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest<PurposeRequest>();
      request.instructionPurpose = parseInstructionPurpose(request.headers, legalBases);
      return true;
    }
  }
  return mixin(InstructionPurposeGuard);
}

/**
 * Requires an instruction route's caller to declare why it instructs the system (ADR-008, ADR-009:
 * payroll only after a recorded decision): `X-Legal-Basis`, one of `legalBases`, and optionally
 * the case in `X-Case-Ref`, which `@CurrentInstructionPurpose()` reads. Documents the headers and
 * the 400.
 */
export const InstructionPurposeHeaders = (legalBases: readonly InstructionLegalBasis[]) =>
  applyDecorators(
    UseGuards(instructionPurposeGuard(legalBases)),
    ApiHeader({
      name: 'X-Legal-Basis',
      required: true,
      description: `Why the system is instructed, recorded with the instruction: ${legalBases.join(' or ')}`,
      schema: { type: 'string', enum: [...legalBases] },
    }),
    ApiHeader({
      name: 'X-Case-Ref',
      required: false,
      description: 'Review case the instruction is for; recorded with the instruction',
      schema: { type: 'string', pattern: CASE_REF.source },
    }),
    ApiProblemResponse(
      HttpStatus.BAD_REQUEST,
      'X-Legal-Basis missing or not one the instruction may be sent on, X-Case-Ref malformed, or the body invalid',
    ),
  );

/** The purpose `@InstructionPurposeHeaders()` read. */
export const CurrentInstructionPurpose = createParamDecorator(
  (_: unknown, context: ExecutionContext): InstructionPurpose => {
    const purpose = context.switchToHttp().getRequest<PurposeRequest>().instructionPurpose;
    if (!purpose) {
      throw new Error(
        'CurrentInstructionPurpose used on a route without InstructionPurposeHeaders()',
      );
    }
    return purpose;
  },
);

function single(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? undefined : header;
}

function invalid(path: string, message: string): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    errors: [{ path, message }],
  });
}
