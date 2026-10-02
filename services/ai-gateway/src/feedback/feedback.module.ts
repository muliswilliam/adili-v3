import { Module } from '@nestjs/common';

import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

/** Reviewers' ratings of job outputs (spec 07c). */
@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
