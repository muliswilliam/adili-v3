import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ReadinessCheck } from '@adili/api-kit';
import { Client, Connection } from '@temporalio/client';

export interface TemporalModuleOptions {
  address: string;
  namespace: string;
}

/** Injection token for the Temporal client used to start and signal workflows. */
export const TEMPORAL_CLIENT = Symbol('TEMPORAL_CLIENT');
export const InjectTemporalClient = () => Inject(TEMPORAL_CLIENT);

@Injectable()
export class TemporalReadinessCheck extends ReadinessCheck implements OnApplicationShutdown {
  readonly name = 'temporal';

  constructor(@InjectTemporalClient() private readonly client: Client) {
    super();
  }

  async check(): Promise<void> {
    await this.client.workflowService.getSystemInfo({});
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.connection.close();
  }
}

/**
 * Connects to Temporal (ADR-003). Workers are added by the services that host workflows
 * or activities, each on its own task queue (ADR-013 §4).
 */
@Module({})
export class TemporalModule {
  static forRoot(options: TemporalModuleOptions): DynamicModule {
    return {
      module: TemporalModule,
      global: true,
      providers: [
        {
          provide: TEMPORAL_CLIENT,
          // Lazy connection: the service starts (not ready) even if Temporal is down.
          useFactory: () =>
            new Client({
              connection: Connection.lazy({ address: options.address }),
              namespace: options.namespace,
            }),
        },
        TemporalReadinessCheck,
      ],
      exports: [TEMPORAL_CLIENT, TemporalReadinessCheck],
    };
  }
}
