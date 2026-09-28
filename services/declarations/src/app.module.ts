import { Module } from '@nestjs/common';
import { CoreModule } from '@adili/api-kit';
import { CacheModule, ValkeyReadinessCheck } from '@adili/cache';
import {
  DatabaseModule,
  DatabaseReadinessCheck,
  FieldCipher,
  OpenBaoReadinessCheck,
  OpenBaoTransitCipher,
} from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import {
  TemporalModule,
  TemporalReadinessCheck,
  TemporalWorkerReadinessCheck,
} from '@adili/temporal';

import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { ObligationsModule } from './obligations/obligations.module.js';

const openbao = { url: config.OPENBAO_ADDR, token: config.OPENBAO_TOKEN };

@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [
        DatabaseReadinessCheck,
        RabbitMqReadinessCheck,
        TemporalReadinessCheck,
        TemporalWorkerReadinessCheck,
        ValkeyReadinessCheck,
        new OpenBaoReadinessCheck(openbao),
      ],
    }),
    DatabaseModule.forRoot({
      url: config.DATABASE_URL,
      schema,
      applicationName: SERVICE_NAME,
    }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    CacheModule.forRoot({ url: config.VALKEY_URL, keyPrefix: `${SERVICE_NAME}:` }),
    ObligationsModule,
  ],
  providers: [{ provide: FieldCipher, useValue: new OpenBaoTransitCipher(openbao) }],
})
export class AppModule {}
