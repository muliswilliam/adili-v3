import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';
import { REVIEW_INTERNAL_SCOPE } from '@adili/roles';

import { config } from '../config.js';
import { HttpReviewClient } from './http-review-client.js';
import { ReviewClient } from './review-client.js';

/** The review internal API, called with the service's own token (ADR-013 §8.1). */
@Module({
  providers: [
    {
      provide: ReviewClient,
      useFactory: () =>
        new HttpReviewClient({
          reviewUrl: config.REVIEW_API_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: config.OIDC_ISSUER_URL,
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [REVIEW_INTERNAL_SCOPE],
          }),
        }),
    },
  ],
  exports: [ReviewClient],
})
export class ReviewModule {}
