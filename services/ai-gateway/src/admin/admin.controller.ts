import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
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
  type GateCell,
  type GateChange,
  GatePolicies,
  type TenantGate,
} from '../policy/gate-policies.js';
import { budgetInput, gatePolicyInput, tenantParam } from './admin-input.js';

/** Contract `GatePolicyList`. */
interface GatePolicyList {
  defaults: GateCell[];
  tenants: TenantGate[];
}

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
  @ApiOperation({ operationId: 'listGatePolicies' })
  @ApiOkResponse({ description: 'Policies' })
  @ApiProblemResponse(403, FORBIDDEN)
  async listGatePolicies(): Promise<GatePolicyList> {
    return { defaults: defaultGate(), tenants: await this.gate.list() };
  }

  @Put('policies/:tenant')
  @ApiOperation({ operationId: 'setGatePolicy' })
  @ApiOkResponse({ description: 'Updated' })
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
  @ApiOperation({ operationId: 'getRouting' })
  @ApiOkResponse({ description: 'Routing' })
  @ApiProblemResponse(403, FORBIDDEN)
  getRouting(): Promise<RouteView[]> {
    return this.routing.table();
  }

  @Get('usage')
  @ApiOperation({ operationId: 'listTenantUsage' })
  @ApiOkResponse({ description: 'Usage' })
  @ApiProblemResponse(403, FORBIDDEN)
  listTenantUsage(): Promise<UsageList> {
    return this.budgets.list();
  }

  @Get('tenants/:tenant/usage')
  @ApiOperation({ operationId: 'getTenantUsage' })
  @ApiOkResponse({ description: 'Usage' })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, FORBIDDEN)
  getTenantUsage(
    @Param('tenant', new ZodValidationPipe(tenantParam)) tenant: string,
  ): Promise<TenantUsage> {
    return this.budgets.usage(tenant);
  }

  @Put('tenants/:tenant/usage')
  @ApiOperation({ operationId: 'setTenantBudget' })
  @ApiOkResponse({ description: 'Updated' })
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
