import { describe, expect, it } from 'vitest';

import { issueText } from './issue-text';

describe('issueText', () => {
  it("keeps the service's own sentences as they are", () => {
    const message = 'Add your dependent children or tick "No dependent children".';
    expect(issueText({ path: '/children', message })).toBe(message);
  });

  it('names the field a schema fragment is about', () => {
    expect(issueText({ path: '/birth/place', message: 'is required' })).toBe(
      'Place of birth is required.',
    );
    expect(issueText({ path: '/birth', message: 'is required' })).toBe(
      'Date and place of birth is required.',
    );
    expect(issueText({ path: '/address/physical', message: 'is required' })).toBe(
      'Physical address is required.',
    );
    expect(issueText({ path: '/maritalStatusChange/explanation', message: 'is required' })).toBe(
      'Explanation of the change in marital status is required.',
    );
  });

  it('names the item a field is on, counting from one', () => {
    expect(issueText({ path: '/income/0/change/explanation', message: 'is required' })).toBe(
      'Income item 1: explanation of the change is required.',
    );
    expect(issueText({ path: '/assets/2/joint/sharePercent', message: 'is required' })).toBe(
      'Asset 3: share is required.',
    );
    expect(issueText({ path: '/spouses/items/0/separationDate', message: 'is required' })).toBe(
      'Spouse 1: date of separation is required.',
    );
    expect(
      issueText({ path: '/liabilities/1/outstanding/kesCents', message: 'must be >= 0' }),
    ).toBe('Liability 2: amount must be >= 0.');
  });

  it('words a field it has no name for from its key', () => {
    expect(issueText({ path: '/children/items/1/schoolName', message: 'is required' })).toBe(
      'Child 2: school name is required.',
    );
  });
});
