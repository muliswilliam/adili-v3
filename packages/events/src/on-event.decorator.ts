import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { EventPattern, RmqContext } from '@nestjs/microservices';
import { catchError, type Observable, tap } from 'rxjs';

/**
 * Acknowledges a message after its handler succeeds. A failed message is retried once,
 * then dead-lettered to the service's DLQ for inspection.
 */
@Injectable()
export class RmqAckInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RmqAckInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rmq = context.switchToRpc().getContext<RmqContext>();
    const channel = rmq.getChannelRef() as {
      ack(message: unknown): void;
      nack(message: unknown, allUpTo: boolean, requeue: boolean): void;
    };
    const message = rmq.getMessage() as { fields: { redelivered: boolean } };

    return next.handle().pipe(
      tap({
        complete: () => {
          channel.ack(message);
        },
      }),
      catchError((error: unknown) => {
        const requeue = !message.fields.redelivered;
        this.logger.error(
          { err: error, pattern: rmq.getPattern(), requeue },
          'Event handler failed',
        );
        channel.nack(message, false, requeue);
        throw error;
      }),
    );
  }
}

/** Handles a domain event type, e.g. `@OnEvent('declaration.submitted.v1')`. */
export const OnEvent = (type: string): MethodDecorator =>
  applyDecorators(
    // The explicit type argument selects the untyped `MethodDecorator` overload.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-arguments
    EventPattern<string>(type),
    UseInterceptors(RmqAckInterceptor),
  );
