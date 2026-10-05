import { Controller, Get, HttpStatus, Inject, Res, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { Public } from '../auth/public.decorator.js';
import { ReadinessCheck } from './readiness-check.js';

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');
export const HEALTH_INFO = Symbol('HEALTH_INFO');

const CHECK_TIMEOUT_MS = 2_000;

interface CheckResult {
  status: 'up' | 'down';
  error?: string;
}

@ApiExcludeController()
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(READINESS_CHECKS)
    private readonly registered: (Type<ReadinessCheck> | ReadinessCheck)[],
    private readonly moduleRef: ModuleRef,
    @Inject(HEALTH_INFO) private readonly info: Record<string, string>,
  ) {}

  /** Liveness: the process is running. Never checks dependencies. */
  @Get('live')
  live(): { status: 'up' } {
    return { status: 'up' };
  }

  /** Readiness: every dependency answers within the timeout, plus the process's `info`. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    // Provider checks live in the modules that own the dependency, so resolve them app-wide.
    const checks = this.registered.map((check) =>
      check instanceof ReadinessCheck ? check : this.moduleRef.get(check, { strict: false }),
    );
    const results = await Promise.all(
      checks.map(async (check): Promise<[string, CheckResult]> => {
        try {
          await withTimeout(check.check(), CHECK_TIMEOUT_MS);
          return [check.name, { status: 'up' }];
        } catch (error) {
          return [check.name, { status: 'down', error: errorMessage(error) }];
        }
      }),
    );
    const up = results.every(([, result]) => result.status === 'up');
    void reply.status(up ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: up ? 'up' : 'down',
      checks: Object.fromEntries(results),
      ...(Object.keys(this.info).length > 0 && { info: this.info }),
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return errorMessage(error.errors[0]);
  }
  if (!(error instanceof Error)) {
    return String(error);
  }
  // fetch() reports network failures as "fetch failed" with the reason in `cause`.
  const cause = error.cause as { code?: string } | undefined;
  const message = error.message || error.name;
  return cause?.code ? `${message} (${cause.code})` : message;
}
