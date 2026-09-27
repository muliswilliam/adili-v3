import {
  type DynamicModule,
  Injectable,
  type InjectionToken,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyStore, type IdempotencyStoreOptions } from './idempotency.store.js';
import {
  type IdempotencyDatabase,
  PostgresIdempotencyStore,
} from './postgres-idempotency.store.js';

export type IdempotencyModuleOptions =
  | (IdempotencyStoreOptions & {
      /**
       * Injection token of the service's Drizzle database (`DATABASE` from
       * `@adili/data-access`). Its schema must include `idempotencySchema`.
       */
      database: InjectionToken;
    })
  /** A ready-made store, e.g. `InMemoryIdempotencyStore` in tests. */
  | { store: IdempotencyStore };

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/** Deletes expired keys hourly. Every replica runs it; the delete is idempotent. */
@Injectable()
class IdempotencyJanitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IdempotencyJanitor.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly store: IdempotencyStore) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.store.purgeExpired().catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Purging expired idempotency keys failed');
      });
    }, PURGE_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }
}

/**
 * Enables `@RequireIdempotencyKey()` routes. Import once in the service's root module.
 *
 * @example
 * IdempotencyModule.forRoot({ database: DATABASE })
 */
@Module({})
export class IdempotencyModule {
  static forRoot(options: IdempotencyModuleOptions): DynamicModule {
    const storeProvider =
      'store' in options
        ? { provide: IdempotencyStore, useValue: options.store }
        : {
            provide: IdempotencyStore,
            useFactory: (db: IdempotencyDatabase) => new PostgresIdempotencyStore(db, options),
            inject: [options.database],
          };
    return {
      module: IdempotencyModule,
      global: true,
      providers: [storeProvider, IdempotencyInterceptor, IdempotencyJanitor],
      exports: [IdempotencyStore, IdempotencyInterceptor],
    };
  }
}
