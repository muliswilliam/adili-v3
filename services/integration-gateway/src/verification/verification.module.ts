import { Module } from '@nestjs/common';

import { StoredResultsController } from './stored-results.controller.js';

/** Stored lookup results read back by the services of their tenant. */
@Module({
  controllers: [StoredResultsController],
})
export class VerificationModule {}
