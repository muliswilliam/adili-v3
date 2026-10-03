import { Module } from '@nestjs/common';

import { Clock, SystemClock } from './clock.js';

/** The service's `Clock`, for the HTTP modules and the worker's activities alike. */
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class ClockModule {}
