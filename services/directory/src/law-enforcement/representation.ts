import { z } from 'zod';

import { assignReportingOfficerBody } from '../commissions/assign-reporting-officer.js';
import { LEA_OFFICER_STATES } from './schema.js';

/**
 * Shapes of the law-enforcement accounts API (spec 10). They are the contract: the OpenAPI
 * document (packages/schemas/internal/directory.yaml) is generated from these schemas.
 */

export const agencyCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/)
  .meta({ description: 'Upper-case agency code', examples: ['DCI', 'ODPP', 'ARA', 'FRC'] });

export const agencySchema = z.object({
  code: agencyCodeSchema,
  name: z.string().meta({ examples: ['Directorate of Criminal Investigations'] }),
  legalBasis: z.string().meta({
    description: 'The statute that gives the agency its mandate',
    examples: ['National Police Service Act, 2011, s.35'],
  }),
});
export type Agency = z.infer<typeof agencySchema>;

export const leaOfficerStateSchema = z.enum(LEA_OFFICER_STATES).meta({
  description:
    "`invited` once provisioned; `activated` when the officer's account first makes an authenticated request to the directory (in practice the console's `/v1/me` after their first sign-in); `revoked` once disabled.",
});

export const leaOfficerAccountSchema = z.object({
  id: z.uuid().meta({
    description:
      "The officer's directory person id, which services address notifications and packages to",
  }),
  agencyCode: agencyCodeSchema,
  name: z.string(),
  email: z.email().meta({ description: 'Official email; the username they sign in with' }),
  phone: z.string().meta({ description: 'E.164', examples: ['+254712345678'] }),
  state: leaOfficerStateSchema,
  invitedAt: z.iso
    .datetime()
    .meta({ description: 'When the account was provisioned (or provisioned again)' }),
  activatedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: "First authenticated request of the officer's account; null until then" }),
  revokedAt: z.iso.datetime().nullable(),
});
export type LeaOfficerAccount = z.infer<typeof leaOfficerAccountSchema>;

/**
 * `GET /internal/v1/law-enforcement/officers/{personId}`: an officer's account as the access
 * service checks a law enforcement request's provenance (r.23(1)): which agency it is of, the
 * Keycloak account the request was sent from, and whether it is still active.
 */
export const internalLeaOfficerSchema = z.object({
  personId: z.uuid().meta({ description: "The officer's directory person id (token `person_id`)" }),
  keycloakUserId: z.string().meta({
    description: "The officer's Keycloak account: the `sub` of the tokens they request with",
  }),
  name: z.string(),
  agency: agencySchema,
  state: leaOfficerStateSchema,
  activatedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type InternalLeaOfficer = z.infer<typeof internalLeaOfficerSchema>;

/**
 * Body of `POST /v1/law-enforcement/agencies/{code}/officers`: the officer's name, official email
 * and phone, validated as a reporting officer's are. The email is stored in lower case.
 */
export const provisionAgencyOfficerBody = assignReportingOfficerBody;
export type ProvisionAgencyOfficerBody = z.infer<typeof provisionAgencyOfficerBody>;
