import { createService } from '@adili/api-kit';
import { eventsServerOptions } from '@adili/events';

import { AppModule } from './app.module.js';
import { config, SERVICE_DESCRIPTION, SERVICE_NAME } from './config.js';
import { OPENAPI_SCHEMAS } from './openapi.js';

await createService({
  name: SERVICE_NAME,
  description: SERVICE_DESCRIPTION,
  module: AppModule,
  openApiSchemas: OPENAPI_SCHEMAS,
  config,
  microservices: [eventsServerOptions({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL })],
});
