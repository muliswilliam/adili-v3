import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ReadinessCheck } from '@adili/api-kit';
import { Redis } from 'iovalkey';

export interface CacheModuleOptions {
  url: string;
  /** Namespaces every key, e.g. `declarations:`. */
  keyPrefix: string;
}

/**
 * A Valkey client as the services use it. Connects on first command and fails commands quickly
 * while disconnected instead of queueing them.
 */
export function createValkey(options: CacheModuleOptions): Redis {
  return new Redis(options.url, {
    keyPrefix: options.keyPrefix,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
  });
}

/** Injection token for the Valkey client (drafts, sessions, rate limits, reference data). */
export const VALKEY = Symbol('VALKEY');
export const InjectValkey = () => Inject(VALKEY);

@Injectable()
export class ValkeyReadinessCheck extends ReadinessCheck implements OnApplicationShutdown {
  readonly name = 'valkey';

  constructor(@InjectValkey() private readonly valkey: Redis) {
    super();
  }

  async check(): Promise<void> {
    await this.valkey.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.valkey.quit();
  }
}

@Module({})
export class CacheModule {
  static forRoot(options: CacheModuleOptions): DynamicModule {
    return {
      module: CacheModule,
      global: true,
      providers: [
        {
          provide: VALKEY,
          useFactory: () => createValkey(options),
        },
        ValkeyReadinessCheck,
      ],
      exports: [VALKEY, ValkeyReadinessCheck],
    };
  }
}
