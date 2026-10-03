import type { DeclarationSectionKey } from '@adili/forms';
import { eq } from 'drizzle-orm';

import { declarations, declarationSections } from '../../src/db/schema.js';
import { sectionIs } from '../../src/drafts/repository.js';
import { SectionCipher } from '../../src/drafts/section-cipher.js';
import type { SectionContents } from '../../src/drafts/sections.js';
import type { DeclarationsApi } from './declarations-api.js';

/**
 * Rewrites a saved section's contents in the store, at the version it was saved, for what only
 * the service writes and a save does not take from the client: an item's `source` (spec 05b),
 * which accepting a suggestion sets.
 */
export async function givenStoredSection(
  api: DeclarationsApi,
  personId: string,
  declarationId: string,
  sectionKey: DeclarationSectionKey,
  edit: (contents: SectionContents) => SectionContents,
): Promise<void> {
  const sections = api.app.get(SectionCipher);
  await api.asPerson(personId, async (tx) => {
    const [declaration] = await tx
      .select()
      .from(declarations)
      .where(eq(declarations.id, declarationId));
    const [row] = await tx
      .select()
      .from(declarationSections)
      .where(sectionIs(declarationId, sectionKey));
    if (!declaration || !row) throw new Error(`Declaration ${declarationId} has no ${sectionKey}`);
    const contents = edit(await sections.open(declaration.tenant, row));
    const sealed = await sections.seal(declaration.tenant, declarationId, sectionKey, contents);
    await tx.update(declarationSections).set(sealed).where(sectionIs(declarationId, sectionKey));
    // The cached plaintext of this version would otherwise be read instead.
    await sections.cache(row, contents);
  });
}
