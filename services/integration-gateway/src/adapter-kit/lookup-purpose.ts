import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { ApiProblemResponse, type AuthenticatedRequest, ProblemException } from '@adili/api-kit';

import { LEGAL_BASES, type LegalBasis } from '../db/schema.js';
import type { LookupPurpose } from './registry-adapter.js';

export const LEGAL_BASIS_HEADER = 'x-legal-basis';
export const CASE_REF_HEADER = 'x-case-ref';

/** A case reference as callers send it: an id or printed reference, never free text. */
const CASE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

type PurposeRequest = AuthenticatedRequest & { lookupPurpose?: LookupPurpose };

/**
 * Reads why a lookup is made from `X-Legal-Basis` (required, one of `LEGAL_BASES`) and
 * `X-Case-Ref` (optional). Malformed headers are a 400 problem naming the header.
 */
export function parseLookupPurpose(headers: PurposeRequest['headers']): LookupPurpose {
  const legalBasis = single(headers[LEGAL_BASIS_HEADER]);
  if (!legalBasis || !(LEGAL_BASES as readonly string[]).includes(legalBasis)) {
    throw invalid('X-Legal-Basis', `Must name the legal basis: one of ${LEGAL_BASES.join(', ')}`);
  }
  const caseRef = single(headers[CASE_REF_HEADER]);
  if (caseRef !== undefined && !CASE_REF.test(caseRef)) {
    throw invalid('X-Case-Ref', 'Must be an id or reference of at most 100 characters');
  }
  return { legalBasis: legalBasis as LegalBasis, caseRef: caseRef ?? null };
}

@Injectable()
class LookupPurposeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PurposeRequest>();
    request.lookupPurpose = parseLookupPurpose(request.headers);
    return true;
  }
}

/**
 * Requires a lookup route's caller to declare why it looks (ADR-008: legal basis on every
 * lookup), which `@Purpose()` reads. Documents both headers and the 400.
 *
 * @example
 * @Get('owners/:nationalId/vehicles')
 * @LookupPurposeHeaders()
 * vehicles(@Purpose() purpose: LookupPurpose) {}
 */
export const LookupPurposeHeaders = () =>
  applyDecorators(
    UseGuards(LookupPurposeGuard),
    ApiHeader({
      name: 'X-Legal-Basis',
      required: true,
      description:
        'Why the registry is consulted, recorded on the result and the audit event. regs-r20-1-b, act-s35-5, adr-014-onboarding or declarant-request (lookups the declarant asked for while filing; DPA s.30(1)(a))',
      schema: { type: 'string', enum: [...LEGAL_BASES] },
    }),
    ApiHeader({
      name: 'X-Case-Ref',
      required: false,
      description: 'Review case the lookup is for; recorded on the result and the audit event',
      schema: { type: 'string', pattern: CASE_REF.source },
    }),
    ApiProblemResponse(
      HttpStatus.BAD_REQUEST,
      'X-Legal-Basis missing or unknown, or X-Case-Ref malformed',
    ),
  );

/** The purpose `@LookupPurposeHeaders()` read. */
export const Purpose = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const purpose = context.switchToHttp().getRequest<PurposeRequest>().lookupPurpose;
  if (!purpose) throw new Error('Purpose used on a route without LookupPurposeHeaders()');
  return purpose;
});

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
