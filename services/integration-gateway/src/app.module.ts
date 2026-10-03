import { Module } from '@nestjs/common';
import { CoreModule, HttpReadinessCheck, IdempotencyModule } from '@adili/api-kit';
import { CacheModule } from '@adili/cache';
import { DATABASE, DatabaseModule, DatabaseReadinessCheck } from '@adili/data-access';
import { EventsModule, RabbitMqReadinessCheck } from '@adili/events';
import { TemporalModule, TemporalReadinessCheck } from '@adili/temporal';

import { AdapterKitModule } from './adapter-kit/adapter-kit.module.js';
import { config, SERVICE_NAME } from './config.js';
import { schema } from './db/schema.js';
import { IcmsModule } from './icms/icms.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { IprsModule } from './iprs/iprs.module.js';
import { PayrollModule } from './payroll/payroll.module.js';
import { RegistriesModule } from './registries/registries.module.js';
import { SYSTEM_POLICY_CONFIG } from './system-policy-config.js';
import { VerificationModule } from './verification/verification.module.js';

@Module({
  imports: [
    CoreModule.forRoot({
      serviceName: SERVICE_NAME,
      config,
      readiness: [
        DatabaseReadinessCheck,
        RabbitMqReadinessCheck,
        TemporalReadinessCheck,
        // Not Valkey: lookups skip the cache while it is down, so it is no reason to go unready.
        new HttpReadinessCheck('government-systems', `${config.MOCKS_BASE_URL}/health`),
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
    AdapterKitModule.forRoot({
      policies: SYSTEM_POLICY_CONFIG,
      breaker: {
        failureThreshold: config.BREAKER_FAILURE_THRESHOLD,
        cooldownMs: config.BREAKER_COOLDOWN_MS,
      },
      subjectHashKey: config.SUBJECT_HASH_KEY,
      openbao: { url: config.OPENBAO_ADDR, token: config.OPENBAO_TOKEN },
    }),
    IprsModule,
    RegistriesModule,
    PayrollModule,
    IcmsModule,
    VerificationModule,
    IntegrationsModule,
  ],
})
export class AppModule {}
