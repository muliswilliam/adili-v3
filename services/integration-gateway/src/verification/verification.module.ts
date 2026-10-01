import { Module } from '@nestjs/common';

import { AdapterKitModule } from '../adapter-kit/adapter-kit.module.js';
import { StoredResultsController } from './stored-results.controller.js';

/** Stored lookup results read back by the services of their tenant. */
@Module({
  imports: [AdapterKitModule],
  controllers: [StoredResultsController],
})
export class VerificationModule {}
