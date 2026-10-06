import { z } from 'zod';

import { SECTION_KEY } from './sections.js';

/**
 * A section's key in the contract, on its own so the suggestions' bodies can name it while the
 * drafts' bodies name a suggestion (a section save answers with the suggestions it reopened).
 */
export const sectionKeySchema = z
  .string()
  .regex(SECTION_KEY)
  .meta({ description: 'bio, household, other, or statement:<personKey>' });
