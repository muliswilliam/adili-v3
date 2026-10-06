import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../clock.js';
import {
  ApplicantProfileController,
  InternalApplicantsController,
} from './applicants.controller.js';
import { ApplicantsService } from './applicants.service.js';
import {
  DeclarantProfileController,
  InternalPersonNationalIdController,
  InternalPersonPreferredLanguageController,
  InternalPersonsController,
  PersonsController,
} from './persons.controller.js';
import { PersonsService } from './persons.service.js';

/**
 * Persons (spec 03): the declarant's own profile (`GET /v1/me/declarant`) and the helpdesk's
 * lookup by officer reference (`GET /v1/persons?ofr=`); their verified contacts for services
 * (`GET /internal/v1/persons/{personId}/contacts`, spec 04) and their national ID for their own
 * registry lookups (`GET /internal/v1/persons/{personId}/national-id`, spec 05b); the language a
 * declarant prefers, which they set themself and the review service reads (spec 07c FE-3). Applicants
 * (spec 10): their own profile (`GET /v1/me/applicant`), and for the access service their
 * particulars and the record of an officer's verification (`/internal/v1/applicants/{personId}`).
 * Onboarding creates them.
 */
@Module({
  controllers: [
    DeclarantProfileController,
    PersonsController,
    InternalPersonsController,
    InternalPersonNationalIdController,
    InternalPersonPreferredLanguageController,
    ApplicantProfileController,
    InternalApplicantsController,
  ],
  providers: [{ provide: Clock, useClass: SystemClock }, PersonsService, ApplicantsService],
})
export class PersonsModule {}
