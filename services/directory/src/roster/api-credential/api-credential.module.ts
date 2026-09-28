import { Module } from '@nestjs/common';

import { ApiCredentialController } from './api-credential.controller.js';
import { ApiCredentialService } from './api-credential.service.js';

/** The HR-system credential of each Commission (spec #27). */
@Module({
  controllers: [ApiCredentialController],
  providers: [ApiCredentialService],
})
export class ApiCredentialModule {}
