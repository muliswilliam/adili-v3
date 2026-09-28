import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnModuleInit,
  type Type,
} from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { RATE_LIMIT_GROUP, RATE_LIMIT_POLICIES, RateLimitGuard } from './rate-limit.guard.js';
import { type RateLimitPolicy, RateLimitStore } from './rate-limit.store.js';

export interface RateLimitModuleOptions {
  /** Policy per route group, from configuration: parse an environment variable with `rateLimitsSchema`. */
  policies: Record<string, RateLimitPolicy>;
  /**
   * Where the buckets live: a store class resolved from the application, e.g.
   * `ValkeyRateLimitStore` from `@adili/cache`, or an instance such as `InMemoryRateLimitStore`
   * in tests.
   */
  store: Type<RateLimitStore> | RateLimitStore;
}

/** Fails startup when a `@RateLimit` group has no configured policy, not the first request. */
@Injectable()
class RateLimitPolicyCheck implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_POLICIES) private readonly policies: Record<string, RateLimitPolicy>,
  ) {}

  onModuleInit(): void {
    const missing = new Set<string>();
    for (const { metatype } of this.discovery.getControllers()) {
      if (typeof metatype !== 'function') continue;
      const controller = metatype as Type;
      const handlers = this.scanner
        .getAllMethodNames(controller.prototype as object)
        .map((name) => (controller.prototype as Record<string, unknown>)[name])
        .filter((handler): handler is Type => typeof handler === 'function');
      for (const target of [controller, ...handlers]) {
        const group = this.reflector.get<string | undefined>(RATE_LIMIT_GROUP, target);
        if (group !== undefined && !(group in this.policies)) missing.add(group);
      }
    }
    if (missing.size > 0) {
      throw new Error(
        `No rate limit configured for @RateLimit group(s) ${[...missing].join(', ')}; configured: ${Object.keys(this.policies).join(', ') || 'none'}`,
      );
    }
  }
}

/**
 * Enables `@RateLimit()` routes. Import once in the service's root module.
 *
 * @example
 * RateLimitModule.forRoot({ policies: config.RATE_LIMITS, store: ValkeyRateLimitStore })
 */
@Module({})
export class RateLimitModule {
  static forRoot(options: RateLimitModuleOptions): DynamicModule {
    const { store } = options;
    return {
      module: RateLimitModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [
        store instanceof RateLimitStore
          ? { provide: RateLimitStore, useValue: store }
          : { provide: RateLimitStore, useClass: store },
        { provide: RATE_LIMIT_POLICIES, useValue: options.policies },
        RateLimitGuard,
        RateLimitPolicyCheck,
      ],
      exports: [RateLimitStore, RATE_LIMIT_POLICIES, RateLimitGuard],
    };
  }
}
