import { Module } from '@nestjs/common';

import { config } from '../config.js';
import {
  PAYROLL_CLIENT_OPTIONS,
  PayrollClient,
  type PayrollClientOptions,
} from './payroll-client.js';
import { PayrollController } from './payroll.controller.js';
import { PayrollInstructions } from './payroll-instructions.js';

/** Payroll instructions (`/internal/v1/payroll/instructions`), on the adapter kit (spec 08). */
@Module({
  controllers: [PayrollController],
  providers: [
    PayrollInstructions,
    PayrollClient,
    {
      provide: PAYROLL_CLIENT_OPTIONS,
      useValue: { baseUrl: config.PAYROLL_BASE_URL } satisfies PayrollClientOptions,
    },
  ],
})
export class PayrollModule {}
