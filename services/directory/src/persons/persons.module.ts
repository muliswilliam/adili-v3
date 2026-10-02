import { Module } from '@nestjs/common';

import {
  DeclarantProfileController,
  InternalPersonNationalIdController,
  InternalPersonsController,
  PersonsController,
} from './persons.controller.js';
import { PersonsService } from './persons.service.js';

/**
 * Persons (spec 03): the declarant's own profile (`GET /v1/me/declarant`) and the helpdesk's
 * lookup by officer reference (`GET /v1/persons?ofr=`); their verified contacts for services
 * (`GET /internal/v1/persons/{personId}/contacts`, spec 04) and their national ID for their own
 * registry lookups (`GET /internal/v1/persons/{personId}/national-id`, spec 05b). Onboarding
 * creates them.
 */
@Module({
  controllers: [
    DeclarantProfileController,
    PersonsController,
    InternalPersonsController,
    InternalPersonNationalIdController,
  ],
  providers: [PersonsService],
})
export class PersonsModule {}
