import { Inject, Injectable } from '@nestjs/common';

export const GREETING_PREFIX = Symbol('GREETING_PREFIX');

/** Sample activities with a Nest dependency, registered through the worker module. */
@Injectable()
export class GreetingActivities {
  started = 0;
  completed = 0;
  /** How long `composeGreeting` takes; tests exercising shutdown drain raise it. */
  delayMs = 0;

  constructor(@Inject(GREETING_PREFIX) private readonly prefix: string) {}

  async composeGreeting(name: string): Promise<string> {
    this.started++;
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.completed++;
    return `${this.prefix}, ${name}`;
  }
}
