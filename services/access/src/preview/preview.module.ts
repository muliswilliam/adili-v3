import { Module } from '@nestjs/common';

import { UpstreamModule } from '../upstream.module.js';
import { PreviewController } from './preview.controller.js';
import { PreviewService } from './preview.service.js';

/** The scope preview of Form K and law enforcement requests, before the decision (decision 1). */
@Module({
  imports: [UpstreamModule],
  controllers: [PreviewController],
  providers: [PreviewService],
})
export class PreviewModule {}
