import { Body, Controller, Get, HttpStatus, Put } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ProblemException, Roles, ZodValidationPipe } from '@adili/api-kit';
import { PLATFORM_ADMIN } from '@adili/roles';
import { z } from 'zod';

import { demoWindows } from './demo-windows.js';

const windowsInput = z.object({
  windows: z.record(z.string(), z.string().nullable()),
});

/**
 * Demo stack only (#371): reads and changes the service's demo windows while it runs, so the demo
 * seed starts the windows it needs short (a clarification that goes unanswered in minutes) and
 * the rest legal, without restarting the service. Mounted only when `DEMO_MODE=true`, for
 * platform admins; left out of the API contract.
 */
@ApiExcludeController()
@Controller('v1/demo/windows')
@Roles(PLATFORM_ADMIN)
export class DemoWindowsController {
  @Get()
  get(): { windows: Record<string, number | null> } {
    return { windows: demoWindows.view() };
  }

  @Put()
  put(@Body(new ZodValidationPipe(windowsInput)) input: z.infer<typeof windowsInput>): {
    windows: Record<string, number | null>;
  } {
    try {
      demoWindows.set(input.windows);
    } catch (error) {
      throw new ProblemException(
        {
          type: 'invalid-demo-window',
          title: 'Bad Request',
          status: HttpStatus.BAD_REQUEST,
          detail: (error as Error).message,
        },
        { code: 'invalid-demo-window' },
      );
    }
    return { windows: demoWindows.view() };
  }
}
