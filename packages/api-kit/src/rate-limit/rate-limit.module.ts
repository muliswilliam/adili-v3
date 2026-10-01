import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnModuleInit,
  type Type,
} from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { RateLimitRefundInterceptor } from './rate-limit-refund.interceptor.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RATE_LIMIT_RULES, type RateLimitRule } from './rate-limit.rules.js';
import { RATE_LIMIT_POLICIES, RateLimiter } from './rate-limiter.js';
import {
  RATE_LIMIT_CLOCK,
  type RateLimitClock,
  type RateLimitPolicy,
  RateLimitStore,
} from './rate-limit.store.js';

export interface RateLimitModuleOptions {
  /** Policy per route group, from configuration: parse an environment variable with `rateLimitsSchema`. */
  policies: Record<string, RateLimitPolicy>;
  /**
   * Where the buckets live: a store class resolved from the application, e.g.
   * `ValkeyRateLimitStore` from `@adili/cache`, or an instance such as `InMemoryRateLimitStore`
   * in tests.
   */
  store: Type<RateLimitStore> | RateLimitStore;
  /**
   * The clock buckets are computed with, provided as `RATE_LIMIT_CLOCK`. By default the store
   * keeps time itself (Valkey: its server time, the same for every replica); tests pass their
   * own, or override `RATE_LIMIT_CLOCK`, to exercise refills and resets.
   */
  clock?: RateLimitClock;
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
        const rules = this.reflector.get<RateLimitRule[] | undefined>(RATE_LIMIT_RULES, target);
        for (const { group } of rules ?? []) {
          if (!(group in this.policies)) missing.add(group);
        }
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
        { provide: RATE_LIMIT_CLOCK, useValue: options.clock ?? null },
        RateLimiter,
        RateLimitGuard,
        RateLimitRefundInterceptor,
        RateLimitPolicyCheck,
      ],
      exports: [
        RateLimitStore,
        RATE_LIMIT_POLICIES,
        RATE_LIMIT_CLOCK,
        RateLimiter,
        RateLimitGuard,
        RateLimitRefundInterceptor,
      ],
    };
  }
}
