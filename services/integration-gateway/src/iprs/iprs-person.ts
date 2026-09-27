import { z } from 'zod';

/** integration-gateway.yaml `IprsPerson`: a person as IPRS holds them, in our casing. */
export interface IprsPerson {
  nationalId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string;
  sex: 'F' | 'M';
}

/** external/iprs.yaml `Person`, as the registry sends it. Unused fields are dropped. */
export const registryPersonSchema = z
  .object({
    id_number: z.string().min(1),
    first_name: z.string().min(1),
    middle_name: z.string().nullish(),
    last_name: z.string().min(1),
    date_of_birth: z.iso.date(),
    sex: z.enum(['F', 'M']),
  })
  .transform((person): IprsPerson => ({
    nationalId: person.id_number,
    firstName: person.first_name,
    // IPRS leaves the middle name blank rather than absent for people without one.
    middleName: person.middle_name?.trim() ? person.middle_name : null,
    lastName: person.last_name,
    dateOfBirth: person.date_of_birth,
    sex: person.sex,
  }));

/** National IDs as the contract accepts them. */
export const nationalIdSchema = z.string().regex(/^[0-9]{5,10}$/, 'must be 5 to 10 digits');
