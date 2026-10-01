import 'reflect-metadata';

import helmet from '@fastify/helmet';
import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

import { type BaseEnv, TRUSTED_PROXIES_DEFAULT } from './config.js';
import { createOpenApiDocument, type OpenApiOptions } from './openapi.js';

export interface ServiceOptions {
  name: string;
  description: string;
  module: Type;
  config: BaseEnv;
  /** Named schemas of the OpenAPI document (see `createOpenApiDocument`). */
  openApiSchemas?: OpenApiOptions['schemas'];
  /**
   * Message transports this service consumes, e.g. its RabbitMQ event queue.
   * They run alongside HTTP in one process (Nest hybrid application).
   */
  microservices?: MicroserviceOptions[];
}

/**
 * Starts a DIALs service as a Nest hybrid application: Fastify HTTP for the public (`/v1`)
 * and internal (`/internal/v1`) APIs, plus message transports for events (ADR-013).
 */
export async function createService(options: ServiceOptions): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: options.config.TRUSTED_PROXIES ?? TRUSTED_PROXIES_DEFAULT,
    requestIdHeader: 'x-request-id',
    genReqId: () => uuidv7(),
  });
  const app = await NestFactory.create<NestFastifyApplication>(options.module, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.register(helmet, {
    // Swagger UI needs inline scripts and styles.
    contentSecurityPolicy: false,
  });

  const openApi: OpenApiOptions = {
    name: options.name,
    description: options.description,
    ...(options.openApiSchemas ? { schemas: options.openApiSchemas } : {}),
  };
  SwaggerModule.setup('docs', app, () => createOpenApiDocument(app, openApi), {
    jsonDocumentUrl: 'docs/openapi.json',
  });

  for (const microservice of options.microservices ?? []) {
    app.connectMicroservice<MicroserviceOptions>(microservice);
  }
  await app.startAllMicroservices();
  await app.listen({ port: options.config.PORT, host: options.config.HOST });
  return app;
}
