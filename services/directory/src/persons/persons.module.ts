import { Module } from '@nestjs/common';

import { DeclarantProfileController, PersonsController } from './persons.controller.js';
import { PersonsService } from './persons.service.js';

/**
 * Persons (spec 03): the declarant's own profile (`GET /v1/me/declarant`) and the helpdesk's
 * lookup by officer reference (`GET /v1/persons?ofr=`). Onboarding creates them.
 */
@Module({
  controllers: [DeclarantProfileController, PersonsController],
  providers: [PersonsService],
})
export class PersonsModule {}
