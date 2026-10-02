import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ProblemException,
  schemaRef,
  CurrentPrincipal,
  type Principal,
  Roles,
  ZodValidationPipe,
} from '@adili/api-kit';
import { PLATFORM_ADMIN } from '@adili/roles';
import { z } from 'zod';

import {
  type RouteInput,
  routeInputSchema,
  Routing,
  type RouteView,
  UnknownProviderError,
} from '../jobs/routing.js';
import { EACC_TASKS, type TaskName, taskNameSchema } from '../tasks/task.js';
import { type BudgetLimits, Budgets, type TenantUsage, type UsageList } from '../policy/budgets.js';
import {
  defaultGate,
  type GateChange,
  GatePolicies,
  type GatePolicyList,
  type TenantGate,
} from '../policy/gate-policies.js';
import {
  ApiApprovalQuery,
  ApiTaskParam,
  ApiTenantParam,
  approvalRefQuery,
  budgetInput,
  gatePolicyInput,
  tenantParam,
} from './admin-input.js';

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

  @Put('routing/:task')
  @ApiTaskParam()
  @ApiOperation({
    operationId: 'setDefaultRoute',
    summary: "Route a task's calls for every tenant without its own route (audited)",
    description:
      'The next job of the task follows it. Audited with the approval reference and announced by `ai.policy.changed.v1` (action `ai.route.changed`).',
  })
  @ApiBody({ required: true, schema: schemaRef('RouteInput') })
  @ApiOkResponse({ description: 'Updated', schema: schemaRef('Route') })
  @ApiProblemResponse(
    400,
    'Request failed validation, or the provider is not one this gateway reaches',
  )
  @ApiProblemResponse(403, FORBIDDEN)
  setDefaultRoute(
    @Param('task', new ZodValidationPipe(taskNameSchema)) task: TaskName,
    @Body(new ZodValidationPipe(routeInputSchema)) body: RouteInput,
    @CurrentPrincipal() principal: Principal,
  ): Promise<RouteView> {
    return this.setRoute(null, task, body, principal);
  }

  @Delete('routing/:task')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTaskParam()
  @ApiApprovalQuery()
  @ApiOperation({
    operationId: 'removeDefaultRoute',
    summary: "Remove a task's default route, back to the configured provider and model (audited)",
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, FORBIDDEN)
  @ApiProblemResponse(404, 'The task has no default route')
  async removeDefaultRoute(
    @Param('task', new ZodValidationPipe(taskNameSchema)) task: TaskName,
    @Query('approvalRef', new ZodValidationPipe(approvalRefQuery)) approvalRef: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    await this.removeRoute(null, task, approvalRef, principal);
  }

  @Put('tenants/:tenant/routing/:task')
  @ApiTenantParam()
  @ApiTaskParam()
  @ApiOperation({
    operationId: 'setTenantRoute',
    summary: "Route a task's calls for one tenant, over the default route (audited)",
    description:
      'The next job of the task for the tenant follows it. Audited with the approval reference and announced by `ai.policy.changed.v1` (action `ai.route.changed`).',
  })
  @ApiBody({ required: true, schema: schemaRef('RouteInput') })
  @ApiOkResponse({ description: 'Updated', schema: schemaRef('Route') })
  @ApiProblemResponse(
    400,
    'Request failed validation, the task is one only EACC calls (it has only a default route), or the provider is not one this gateway reaches',
  )
  @ApiProblemResponse(403, FORBIDDEN)
  setTenantRoute(
    @Param('tenant', new ZodValidationPipe(tenantParam)) tenant: string,
    @Param('task', new ZodValidationPipe(taskNameSchema)) task: TaskName,
    @Body(new ZodValidationPipe(routeInputSchema)) body: RouteInput,
    @CurrentPrincipal() principal: Principal,
  ): Promise<RouteView> {
    // No Commission calls an EACC task, so a Commission's own route of one would route nothing.
    if ((EACC_TASKS as readonly TaskName[]).includes(task)) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: [{ path: 'task', message: 'Must be a task a Commission calls' }],
      });
    }
    return this.setRoute(tenant, task, body, principal);
  }

  @Delete('tenants/:tenant/routing/:task')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTenantParam()
  @ApiTaskParam()
  @ApiApprovalQuery()
  @ApiOperation({
    operationId: 'removeTenantRoute',
    summary: "Remove a tenant's route of a task, back to the default route (audited)",
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, FORBIDDEN)
  @ApiProblemResponse(404, 'The tenant has no route of its own for the task')
  async removeTenantRoute(
    @Param('tenant', new ZodValidationPipe(tenantParam)) tenant: string,
    @Param('task', new ZodValidationPipe(taskNameSchema)) task: TaskName,
    @Query('approvalRef', new ZodValidationPipe(approvalRefQuery)) approvalRef: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    await this.removeRoute(tenant, task, approvalRef, principal);
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

  private async setRoute(
    tenant: string | null,
    task: TaskName,
    body: RouteInput,
    principal: Principal,
  ): Promise<RouteView> {
    try {
      return await this.routing.set(tenant, task, body, principal.subject);
    } catch (error) {
      if (!(error instanceof UnknownProviderError)) throw error;
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: [{ path: 'provider', message: 'Must be a provider this gateway reaches' }],
      });
    }
  }

  private async removeRoute(
    tenant: string | null,
    task: TaskName,
    approvalRef: string,
    principal: Principal,
  ): Promise<void> {
    if (!(await this.routing.remove(tenant, task, approvalRef, principal.subject))) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Not Found',
        status: HttpStatus.NOT_FOUND,
        detail: 'There is no such route.',
      });
    }
  }
}
