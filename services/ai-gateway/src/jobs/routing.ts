import { Inject, Injectable } from '@nestjs/common';

import type { ModelProvider, ProviderClass } from '../providers/port.js';
import { InjectModelProvider } from '../providers/providers.module.js';

export const ROUTING_OPTIONS = Symbol('ROUTING_OPTIONS');

export interface RoutingOptions {
  /** Model every task uses until the routing table (spec 07c BE-3) overrides it. */
  model: string;
}

export interface Route {
  provider: string;
  providerClass: ProviderClass;
  model: string;
}

/**
 * Decides provider and model for a job; callers never do. For now one route for every tenant
 * and task (the routing table of spec 07c BE-3 will key it by both): the configured provider
 * with the configured model.
 */
@Injectable()
export class Routing {
  constructor(
    @InjectModelProvider() private readonly provider: ModelProvider,
    @Inject(ROUTING_OPTIONS) private readonly options: RoutingOptions,
  ) {}

  route(): Route {
    return {
      provider: this.provider.name,
      providerClass: this.provider.providerClass,
      model: this.options.model,
    };
  }
}
