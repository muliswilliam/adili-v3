import { Module } from '@nestjs/common';

import { DemoWindowsController } from './demo-windows.controller.js';

/** Demo stack only (#371): the app imports it only when `DEMO_MODE=true`. */
@Module({ controllers: [DemoWindowsController] })
export class DemoModule {}
