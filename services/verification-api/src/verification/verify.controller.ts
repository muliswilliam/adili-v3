import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags, DECORATORS } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  byClientIp,
  Public,
  RATE_LIMIT_HEADERS,
  RateLimit,
  schemaRef,
} from '@adili/api-kit';

import { VERIFY_RATE_LIMIT } from '../config.js';
import type { VerificationResult } from './representation.js';
import { MAX_CODE_LENGTH, VerifyService } from './verify.service.js';

/** The part of Fastify's reply the route uses. */
interface Reply {
  status(code: number): unknown;
}

/**
 * The public verify API (ADR-010 §5): anyone may look a code up, without a token (`@Public()`,
 * so no security requirement in the contract), within a per client IP budget.
 */
@ApiTags('verify')
@Public()
@Controller('v1/verify')
export class VerifyController {
  constructor(private readonly verification: VerifyService) {}

  @Get(':verificationId')
  @RateLimit(VERIFY_RATE_LIMIT, { key: byClientIp })
  @ApiOperation({
    operationId: 'verifyDocument',
    summary: 'Status of a document issued through Adili Online',
    description:
      'Every lookup of a well-formed code is recorded (verification.checked.v1). Restricted and public documents show their public-safe fields and hash; confidential ones validity only.',
  })
  @ApiParam({
    name: 'verificationId',
    description:
      'Code printed under the QR, e.g. ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-8WNA-9K; hyphens and case are normalised',
    schema: { type: 'string', maxLength: MAX_CODE_LENGTH },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Known document',
    headers: RATE_LIMIT_HEADERS,
    content: { 'application/json': { schema: schemaRef('VerificationResult') } },
  })
  @ApiProblemResponse(HttpStatus.BAD_REQUEST, 'Problem type `malformed-verification-id`')
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No such document (same shape, status not-found)',
    headers: RATE_LIMIT_HEADERS,
    content: { 'application/json': { schema: schemaRef('VerificationResult') } },
  })
  async verify(
    @Param('verificationId') code: string,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<VerificationResult> {
    const result = await this.verification.verify(code);
    if (result.status === 'not-found') reply.status(HttpStatus.NOT_FOUND);
    return result;
  }
}

// No bearer requirement in the contract for this public controller.
Reflect.defineMetadata(DECORATORS.API_SECURITY, [], VerifyController);
