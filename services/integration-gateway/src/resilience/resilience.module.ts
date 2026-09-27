import { Global, Module } from '@nestjs/common';

import { CLOCK, systemClock } from './clock.js';

/** The clock the adapters and their circuit breakers share. */
@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }],
  exports: [CLOCK],
})
export class ResilienceModule {}
