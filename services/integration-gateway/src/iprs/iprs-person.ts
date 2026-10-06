import { z } from 'zod';

import { resultEnvelopeSchema } from '../registries/registry-records.js';

/** `IprsPerson`: a person as IPRS holds them, in our casing. */
export const iprsPersonSchema = z
  .object({
    nationalId: z.string(),
    firstName: z.string(),
    middleName: z.string().nullable(),
    lastName: z.string(),
    dateOfBirth: z.iso.date(),
    placeOfBirth: z.string().nullable(),
    sex: z.enum(['F', 'M']),
  })
  .meta({ description: 'A person as IPRS holds them' });
export type IprsPerson = z.infer<typeof iprsPersonSchema>;

/** external/iprs.yaml `Person`, as the registry sends it. Unused fields are dropped. */
export const registryPersonSchema = z
  .object({
    id_number: z.string().min(1),
    first_name: z.string().min(1),
    middle_name: z.string().nullish(),
    last_name: z.string().min(1),
    date_of_birth: z.iso.date(),
    place_of_birth: z.string().nullish(),
    sex: z.enum(['F', 'M']),
  })
  .transform((person): IprsPerson => ({
    nationalId: person.id_number,
    firstName: person.first_name,
    // IPRS leaves the middle name blank rather than absent for people without one.
    middleName: person.middle_name?.trim() ? person.middle_name : null,
    lastName: person.last_name,
    dateOfBirth: person.date_of_birth,
    placeOfBirth: person.place_of_birth?.trim() ? person.place_of_birth : null,
    sex: person.sex,
  }));

/** Body of `POST /internal/v1/iprs/person-lookups` (`LookupIprsPerson`). */
export const lookupIprsPersonSchema = z.strictObject({
  nationalId: z.string().regex(/^[0-9]{5,10}$/, 'must be 5 to 10 digits'),
});
export type LookupIprsPerson = z.infer<typeof lookupIprsPersonSchema>;

/** `IprsResult`: a recorded lookup's envelope and the person, null unless found. */
export const iprsResultSchema = resultEnvelopeSchema
  .extend({ person: iprsPersonSchema.nullable() })
  .meta({
    description:
      'The person IPRS holds for the national ID. not-found: IPRS has no such person. person is null unless found.',
  });
