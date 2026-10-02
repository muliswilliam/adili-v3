import { type DynamicModule, Module, RequestMethod, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { TokenVerifier } from './auth/token-verifier.js';
import type { BaseEnv } from './config.js';
import { HealthController, READINESS_CHECKS } from './health/health.controller.js';
import type { ReadinessCheck } from './health/readiness-check.js';
import { serializeRequest } from './log-redaction.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

export interface CoreModuleOptions {
  serviceName: string;
  config: BaseEnv;
  /**
   * Dependencies reported by `/health/ready`: provider classes (resolved from the app)
   * or ready-made instances such as `new HttpReadinessCheck(...)`.
   */
  readiness?: (Type<ReadinessCheck> | ReadinessCheck)[];
}

/**
 * Cross-cutting concerns every service gets: structured logging, bearer-token auth,
 * RFC 9457 errors and health endpoints.
 */
@Module({})
export class CoreModule {
  static forRoot(options: CoreModuleOptions): DynamicModule {
    const { config } = options;
    return {
      module: CoreModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          // Probes hit these every few seconds; logging them buries real traffic.
          exclude: [{ path: 'health/{*probe}', method: RequestMethod.GET }],
          pinoHttp: {
            name: options.serviceName,
            level: config.LOG_LEVEL,
            // Request IDs come from Fastify (x-request-id or generated).
            genReqId: (request) => request.id,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            serializers: {
              req: serializeRequest,
              res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
            },
            transport:
              config.NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        }),
      ],
      controllers: [HealthController],
      providers: [
        {
          provide: TokenVerifier,
          useFactory: () => new TokenVerifier(config.OIDC_ISSUER_URL, config.OIDC_AUDIENCE),
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: READINESS_CHECKS, useValue: options.readiness ?? [] },
      ],
      exports: [TokenVerifier],
    };
  }
}
