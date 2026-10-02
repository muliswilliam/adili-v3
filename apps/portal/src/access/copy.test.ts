import { accessMessagesSw, groundMeta } from '@adili/ui';
import { describe, expect, it } from 'vitest';

import { contractEnum } from '../test/contract';
import { STATUS_BANNERS, STATUSES } from './copy';

describe('access request copy (S17)', () => {
  it('has a badge and a banner for every status in access.yaml', () => {
    const statuses = contractEnum('AccessRequestStatus', 'access.yaml').sort();
    expect(Object.keys(STATUSES).sort()).toEqual(statuses);
    expect(Object.keys(STATUS_BANNERS).sort()).toEqual(statuses);
  });

  it('words the statuses as the applicant follows them, from the shared table', () => {
    expect(STATUSES['pending-applicant-verification'].label).toBe('Awaiting identity verification');
    expect(STATUSES['awaiting-representations'].label).toBe('Declarant notified');
    expect(STATUSES.granted.label).toBe('Granted');
  });

  it('quotes Regulation 24 for every ground in access.yaml', () => {
    expect(Object.keys(groundMeta).sort()).toEqual(contractEnum('Ground', 'access.yaml').sort());
    for (const meta of Object.values(groundMeta)) expect(meta.text).toMatch(/^\([a-d]\) /);
  });

  it('says a denied applicant may seek relief from the court', () => {
    expect(STATUS_BANNERS.denied.next.en('Public Service Commission', '')).toContain(
      'You may seek relief from the court.',
    );
  });

  it('keeps the Swahili slots, empty until translated', () => {
    expect(accessMessagesSw).toEqual({});
    for (const banner of Object.values(STATUS_BANNERS)) expect(banner.lead.sw).toBe('');
  });
});
