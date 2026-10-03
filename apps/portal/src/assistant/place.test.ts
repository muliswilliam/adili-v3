import { describe, expect, it } from 'vitest';

import { linkedItem, linkPlace } from './place';

const SPOUSE = 'statement:spouse:3f1e2d4c-5b6a-4789-8abc-def012345678';
const sections = [
  { key: 'bio', completeness: 'complete', updatedAt: null, personName: null },
  { key: 'statement:officer', completeness: 'complete', updatedAt: null, personName: 'John Kamau' },
  { key: SPOUSE, completeness: 'complete', updatedAt: null, personName: 'Mary Wanjiru Kamau' },
] as const;

describe('where an answer links to', () => {
  it("names a field of the officer's statement and opens its tab", () => {
    expect(
      linkPlace({ sectionKey: 'statement:officer', fieldPath: '/assets/2/value' }, sections, 'en'),
    ).toEqual({
      step: 'statement:officer',
      field: '/assets/2/value',
      label: 'Open Assets → value',
    });
  });

  it('names the item by its type once it is read', () => {
    const link = { sectionKey: 'statement:officer', fieldPath: '/assets/1/value' };
    expect(linkPlace(link, sections, 'en', 'Vehicle')?.label).toBe('Open Vehicle → value');
    expect(linkPlace(link, sections, 'sw', 'Vehicle')?.label).toBe('Fungua Mali → thamani');
    expect(linkedItem(link)).toEqual({ category: 'assets', index: 1 });
    expect(linkedItem({ sectionKey: 'statement:officer', fieldPath: '/assets' })).toBeNull();
  });

  it("names a spouse's category by their first name, in both languages", () => {
    const link = { sectionKey: SPOUSE, fieldPath: '/income' };
    expect(linkPlace(link, sections, 'en')?.label).toBe("Open Mary's income");
    expect(linkPlace(link, sections, 'sw')?.label).toBe('Fungua Mapato ya Mary');
  });

  it('names a section without a field, and a bio field', () => {
    expect(linkPlace({ sectionKey: 'household', fieldPath: null }, sections, 'en')).toEqual({
      step: 'household',
      field: null,
      label: 'Open Spouses and children',
    });
    expect(
      linkPlace({ sectionKey: 'bio', fieldPath: '/employment/nature' }, sections, 'sw')?.label,
    ).toBe('Fungua Maelezo yako → aina ya ajira');
  });

  it('drops a link to a section the draft does not have', () => {
    expect(
      linkPlace(
        { sectionKey: 'statement:child:3f1e2d4c-5b6a-4789-8abc-def012345679', fieldPath: null },
        sections,
        'en',
      ),
    ).toBeNull();
  });
});
