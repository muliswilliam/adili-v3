import { Module } from '@nestjs/common';

import { CommissionsModule } from '../commissions/commissions.module.js';
import { LawEnforcementController } from './law-enforcement.controller.js';
import { LawEnforcementOfficersService } from './officers.service.js';

/**
 * Law-enforcement accounts (spec 10): the agencies EACC issues accounts to, and the platform
 * admin's provisioning and revoking of their officers. Officers' activation is observed with the
 * reporting officers' (`ActivationObserver`), whose lookup cache comes from the Commissions
 * module.
 */
@Module({
  imports: [CommissionsModule],
  controllers: [LawEnforcementController],
  providers: [LawEnforcementOfficersService],
})
export class LawEnforcementModule {}
