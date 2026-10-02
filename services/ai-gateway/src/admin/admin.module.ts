import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module.js';
import { AdminController } from './admin.controller.js';
import { TenantStatusController } from './tenant-status.controller.js';
import { TenantStatus } from './tenant-status.js';

/** Policy, routing and usage for platform admins; a tenant's AI status for services. */
@Module({
  imports: [JobsModule],
  controllers: [AdminController, TenantStatusController],
  providers: [TenantStatus],
})
export class AdminModule {}
