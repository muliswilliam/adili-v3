import { z } from 'zod';

/** Part I (iv)'s rule, one for the field and the server function (`saveFormMManualFields`). */
export const partIEmail = z.email().max(254);

/** Whether an email address will do for Part I (iv): blank, or one the service takes. */
export const emailTakes = (value: string) =>
  !value.trim() || partIEmail.safeParse(value.trim()).success;
