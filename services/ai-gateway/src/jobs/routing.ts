import { Inject, Injectable } from '@nestjs/common';

import type { ModelProvider } from '../providers/port.js';
import { InjectModelProvider } from '../providers/providers.module.js';
import type { TaskDefinition } from '../tasks/task.js';

export const ROUTING_OPTIONS = Symbol('ROUTING_OPTIONS');

export interface RoutingOptions {
  /** Model every task uses until the routing table (spec 07c BE-3) overrides it. */
  model: string;
}

export interface Route {
  provider: string;
  model: string;
  maxOutputTokens: number;
}

/**
 * Decides provider and model for a job; callers never do. For now one route for every tenant
 * and task: the configured provider with the configured model and the task's output limit.
 */
@Injectable()
export class Routing {
  constructor(
    @InjectModelProvider() private readonly provider: ModelProvider,
    @Inject(ROUTING_OPTIONS) private readonly options: RoutingOptions,
  ) {}

  route(_tenant: string, task: TaskDefinition): Route {
    return {
      provider: this.provider.name,
      model: this.options.model,
      maxOutputTokens: task.maxOutputTokens,
    };
  }
}
