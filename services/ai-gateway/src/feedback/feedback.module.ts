import { Module } from '@nestjs/common';

import { CipherModule } from '../cipher.module.js';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

/** Reviewers' ratings of job outputs (spec 07c). */
@Module({
  imports: [CipherModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
