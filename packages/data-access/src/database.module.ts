import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ReadinessCheck } from '@adili/api-kit';
import { sql } from 'drizzle-orm';

import { createDatabase, type Database, type DatabaseOptions } from './database.js';

/** Injection token for the service's Drizzle database. */
export const DATABASE = Symbol('DATABASE');

/** Inject the service's database: `constructor(@InjectDatabase() db: Database<typeof schema>)`. */
export const InjectDatabase = () => Inject(DATABASE);

@Injectable()
export class DatabaseReadinessCheck extends ReadinessCheck {
  readonly name = 'postgres';

  constructor(@InjectDatabase() private readonly db: Database) {
    super();
  }

  async check(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }
}

@Injectable()
class DatabaseLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  constructor(@InjectDatabase() private readonly db: Database) {}

  /**
   * Opens the pool's kept connection before the first request, so that request does not wait
   * for a new Postgres session. Best effort: a database that is down now is readiness's concern.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.db.execute(sql`select 1`);
    } catch (error) {
      this.logger.warn({ err: error }, 'Database not reachable at startup');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}

@Module({})
export class DatabaseModule {
  static forRoot<TSchema extends Record<string, unknown>>(
    options: DatabaseOptions<TSchema>,
  ): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: DATABASE, useFactory: () => createDatabase(options) },
        DatabaseReadinessCheck,
        DatabaseLifecycle,
      ],
      exports: [DATABASE, DatabaseReadinessCheck],
    };
  }
}
