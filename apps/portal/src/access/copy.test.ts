import { describe, expect, it } from 'vitest';

import { contractEnum } from '../test/contract';
import { GROUNDS, STATUS_BANNERS, STATUSES } from './copy';

describe('access request copy (S17)', () => {
  it('has a badge and a banner for every status in access.yaml', () => {
    const statuses = contractEnum('AccessRequestStatus', 'access.yaml').sort();
    expect(Object.keys(STATUSES).sort()).toEqual(statuses);
    expect(Object.keys(STATUS_BANNERS).sort()).toEqual(statuses);
  });

  it('labels every Regulation 24 ground in access.yaml, citing its paragraph', () => {
    expect(Object.keys(GROUNDS).sort()).toEqual(contractEnum('Ground', 'access.yaml').sort());
    for (const label of Object.values(GROUNDS))
      expect(label.en).toMatch(/\(Regulation 24\([a-d]\)\)$/);
  });

  it('says a denied applicant may seek relief from the court', () => {
    expect(STATUS_BANNERS.denied.next.en('Public Service Commission', '')).toContain(
      'You may seek relief from the court.',
    );
  });

  it('keeps the Swahili slots, empty until translated', () => {
    for (const meta of Object.values(STATUSES)) expect(meta.label.sw).toBe('');
  });
});
