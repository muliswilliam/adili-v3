import { Global, Module } from '@nestjs/common';
import { CoreModule, IdempotencyModule } from '@adili/api-kit';
import { CacheModule, ValkeyReadinessCheck } from '@adili/cache';
import {
  DATABASE,
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

import { AcknowledgementModule } from './acknowledgement/acknowledgement.module.js';
import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { DraftsModule } from './drafts/drafts.module.js';
import { ObligationsModule } from './obligations/obligations.module.js';
import { SubmissionModule } from './submission/submission.module.js';

const openbao = { url: config.OPENBAO_ADDR, token: config.OPENBAO_TOKEN };

/** Field encryption with the Commission's key in OpenBao Transit (ADR-006), for every module. */
@Global()
@Module({
  providers: [{ provide: FieldCipher, useValue: new OpenBaoTransitCipher(openbao) }],
  exports: [FieldCipher],
})
class FieldCipherModule {}

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
    IdempotencyModule.forRoot({ database: DATABASE }),
    EventsModule.forRoot({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL }),
    TemporalModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
    }),
    CacheModule.forRoot({ url: config.VALKEY_URL, keyPrefix: `${SERVICE_NAME}:` }),
    FieldCipherModule,
    ObligationsModule,
    DraftsModule,
    SubmissionModule,
    AcknowledgementModule,
  ],
})
export class AppModule {}
