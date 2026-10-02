import { Body, Controller, Get, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  notFoundIfInvisible,
  type Principal,
  schemaRef,
  Scopes,
  ZodValidationPipe,
} from '@adili/api-kit';
import { PAYROLL_SCOPE } from '@adili/roles';
import type { FastifyReply } from 'fastify';

import {
  CurrentInstructionPurpose,
  type InstructionPurpose,
  InstructionPurposeHeaders,
} from '../adapter-kit/lookup-purpose.js';
import { PAYROLL_LEGAL_BASES } from '../db/schema.js';
import { PayrollInstructions } from './payroll-instructions.js';
import {
  INSTRUCTION_REFERENCE,
  type PayrollInstruction,
  type PayrollInstructionRequest,
  payrollInstructionRequestSchema,
  instructionReferenceSchema,
} from './payroll-records.js';

const SCOPE = `Requires a service token with scope \`${PAYROLL_SCOPE}\`. Instructions act for no tenant: the employer is in the instruction (ADR-013 section 8.6).`;
const instruction = (description: string) => ({
  description,
  content: { 'application/json': { schema: schemaRef('PayrollInstruction') } },
});

/**
 * Payroll instructions for the review service's administrative action ladder (spec 08): salary stoppage on
 * a supervisor's approval, and reinstatement on compliance. Internal: services with the
 * `payroll` scope.
 */
@ApiTags('internal')
@ApiBearerAuth()
@Scopes(PAYROLL_SCOPE)
@Controller('internal/v1/payroll/instructions')
export class PayrollController {
  constructor(private readonly instructions: PayrollInstructions) {}

  @Post()
  @InstructionPurposeHeaders(PAYROLL_LEGAL_BASES)
  @ApiOperation({
    operationId: 'submitPayrollInstruction',
    summary:
      'Send a stop or resume salary instruction to payroll (idempotent by instruction reference)',
    description: `Sends the instruction to payroll and stores its acknowledgement (payroll reference, status, received at) with the legal basis and case. Idempotent by instruction reference: the same instruction again answers the stored acknowledgement (200) without calling payroll; another under the same reference is 409. Behind payroll's own circuit breaker, rate limit, timeout and pause; never cached. Payroll not acknowledging is 503 and nothing is recorded as sent: retry. The personal number and national ID travel in the body and are kept only as keyed hashes. ${SCOPE}`,
  })
  @ApiBody({ required: true, schema: schemaRef('PayrollInstructionRequest') })
  @ApiResponse({
    status: HttpStatus.CREATED,
    ...instruction('Sent now and acknowledged by payroll'),
  })
  @ApiResponse({ status: HttpStatus.OK, ...instruction('Already acknowledged (replay)') })
  @ApiProblemResponse(
    HttpStatus.CONFLICT,
    'Problem type `instruction-reference-conflict`: another instruction was sent under the reference',
  )
  @ApiProblemResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    'Problem type `upstream-unavailable`: payroll did not acknowledge (down, timed out, breaker open or paused); nothing recorded as sent',
  )
  async submit(
    @Body(new ZodValidationPipe(payrollInstructionRequestSchema)) body: PayrollInstructionRequest,
    @CurrentInstructionPurpose() purpose: InstructionPurpose,
    @CurrentPrincipal() caller: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PayrollInstruction> {
    const { instruction, replayed } = await this.instructions.submit(body, purpose, caller);
    void reply.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return instruction;
  }

  @Get(':instructionReference')
  @ApiOperation({
    operationId: 'getPayrollInstruction',
    summary: 'Stored instruction and acknowledgement',
    description: `The instruction as payroll acknowledged it, from the gateway's store (payroll is not called). ${SCOPE}`,
  })
  @ApiParam({
    name: 'instructionReference',
    schema: { type: 'string', pattern: INSTRUCTION_REFERENCE.source },
  })
  @ApiResponse({ status: HttpStatus.OK, ...instruction('The instruction') })
  @ApiProblemResponse(HttpStatus.NOT_FOUND, 'No instruction acknowledged under the reference')
  async read(
    @Param('instructionReference', new ZodValidationPipe(instructionReferenceSchema))
    instructionReference: string,
  ): Promise<PayrollInstruction> {
    return notFoundIfInvisible(await this.instructions.read(instructionReference));
  }
}
