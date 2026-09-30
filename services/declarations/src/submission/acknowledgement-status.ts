import { z } from 'zod';

import { ACKNOWLEDGEMENT_STATUS_VALUES } from './schema.js';

/** A version's acknowledgement slip as the declarant sees it (see `acknowledgementStatus`). */
export const acknowledgementStatusSchema = z.enum(ACKNOWLEDGEMENT_STATUS_VALUES);
