import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  schemaRef,
  CurrentPrincipal,
  type Principal,
  Roles,
  ZodValidationPipe,
} from '@adili/api-kit';
import { PLATFORM_ADMIN } from '@adili/roles';
import { z } from 'zod';

import { Routing, type RouteView } from '../jobs/routing.js';
import { type BudgetLimits, Budgets, type TenantUsage, type UsageList } from '../policy/budgets.js';
import {
  defaultGate,
  type GateChange,
  GatePolicies,
  type GatePolicyList,
  type TenantGate,
} from '../policy/gate-policies.js';
import { ApiTenantParam, budgetInput, gatePolicyInput, tenantParam } from './admin-input.js';

const FORBIDDEN = 'Caller is not a platform admin';

/**
 * The AI policy page's API (spec 07c, S16): classification gate, routing, budgets and usage, for
 * platform admins only. Changes are audited with the actor (and the approval reference, for the
 * gate) in the transaction that makes them.
 */
@ApiTags('policy')
@ApiBearerAuth()
@Roles(PLATFORM_ADMIN)
@Controller('v1/ai')
export class AdminController {
  constructor(
    private readonly gate: GatePolicies,
    private readonly budgets: Budgets,
    private readonly routing: Routing,
  ) {}

  @Get('policies')
  @ApiOperation({
    operationId: 'listGatePolicies',
    summary:
      'Classification gate per tenant with explicit rules, and the default for every other pair',
  })
  @ApiOkResponse({ description: 'Policies', schema: schemaRef('GatePolicyList') })
  @ApiProblemResponse(403, FORBIDDEN)
  async listGatePolicies(): Promise<GatePolicyList> {
    return { defaults: defaultGate(), tenants: await this.gate.list() };
  }

  @Put('policies/:tenant')
  @ApiTenantParam()
  @ApiOperation({
    operationId: 'setGatePolicy',
    summary:
      'Allow or block provider classes per data class, all or none (audited with the approval reference)',
    description:
      'The rules apply in one transaction: every rule is stored, or none is. Each rule gets its own audit record and `ai.policy.changed.v1` event, all with the approval reference.',
  })
  @ApiBody({ required: true, schema: schemaRef('GatePolicyInput') })
  @ApiOkResponse({ description: 'Updated', schema: schemaRef('TenantPolicy') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, FORBIDDEN)
  setGatePolicy(
    @Param('tenant', new ZodValidationPipe(tenantParam)) tenant: string,
    @Body(new ZodValidationPipe(gatePolicyInput)) body: GateChange,
    @CurrentPrincipal() principal: Principal,
  ): Promise<TenantGate> {
    return this.gate.set(tenant, body, { subject: principal.subject, name: principal.name });
  }

  @Get('routing')
  @ApiOperation({
    operationId: 'getRouting',
    summary:
      'Effective routing table (task to provider, model and parameters), with tenant overrides',
  })
  @ApiOkResponse({
    description: 'Routing',
    schema: { type: 'array', items: schemaRef('Route') },
  })
  @ApiProblemResponse(403, FORBIDDEN)
  getRouting(): Promise<RouteView[]> {
    return this.routing.table();
  }

  @Get('usage')
  @ApiOperation({
    operationId: 'listTenantUsage',
    summary:
      "This month's budget and usage of every tenant with a budget or a job this month, and the default budget of the others",
  })
  @ApiOkResponse({ description: 'Usage', schema: schemaRef('UsageList') })
  @ApiProblemResponse(403, FORBIDDEN)
  listTenantUsage(): Promise<UsageList> {
    return this.budgets.list();
  }

  @Get('tenants/:tenant/usage')
  @ApiTenantParam()
  @ApiOperation({
    operationId: 'getTenantUsage',
    summary: 'Budget, tokens and cost this month, blocked and failed counts',
  })
  @ApiOkResponse({ description: 'Usage', schema: schemaRef('TenantUsage') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, FORBIDDEN)
  getTenantUsage(
    @Param('tenant', new ZodValidationPipe(tenantParam)) tenant: string,
  ): Promise<TenantUsage> {
    return this.budgets.usage(tenant);
  }

  @Put('tenants/:tenant/usage')
  @ApiTenantParam()
  @ApiOperation({
    operationId: 'setTenantBudget',
    summary: 'Set the monthly token budget and per-minute limit (audited)',
  })
  @ApiBody({ required: true, schema: schemaRef('BudgetInput') })
  @ApiOkResponse({ description: 'Updated', schema: schemaRef('TenantUsage') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, FORBIDDEN)
  setTenantBudget(
    @Param('tenant', new ZodValidationPipe(tenantParam)) tenant: string,
    @Body(new ZodValidationPipe(budgetInput)) body: z.infer<typeof budgetInput>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<TenantUsage> {
    return this.budgets.set(tenant, body satisfies BudgetLimits, principal.subject);
  }
}
