import { Module } from '@nestjs/common';

import { AuditTrail } from './audit-trail.js';
import { IngestConsumer } from './ingest.consumer.js';
import { TrailController } from './trail.controller.js';
import { TrailQueryService } from './trail-query.service.js';
import { ChainVerifier } from './verifier.js';

@Module({
  controllers: [IngestConsumer, TrailController],
  providers: [AuditTrail, ChainVerifier, TrailQueryService],
  exports: [AuditTrail, ChainVerifier],
})
export class TrailModule {}
