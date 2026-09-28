import { describe, expect, it } from 'vitest';

import { sourceDetails } from './item-source';

const AT = '2026-09-26T08:00:00Z';
const suggestionId = '7d1f7a64-3c41-4c55-9d0e-6a9b1b3e2f10';

describe('sourceDetails', () => {
  it('is null for an item entered by hand', () => {
    expect(sourceDetails({ id: 'a', type: 'cash' })).toBeNull();
  });

  it('takes the registration of a vehicle from NTSA', () => {
    expect(
      sourceDetails({
        type: 'vehicle',
        details: { registration: ' KCA 123A ', makeModel: 'Toyota Probox' },
        source: { kind: 'ntsa', suggestionId, at: AT },
      }),
    ).toEqual({ kind: 'ntsa', at: AT, reference: 'KCA 123A' });
  });

  it('takes the parcel number of land from ArdhiSasa and the company for BRS', () => {
    expect(
      sourceDetails({
        type: 'land',
        details: { parcelNumber: 'Eldoret Municipality Block 7/1234' },
        source: { kind: 'ardhisasa', suggestionId, at: AT },
      })?.reference,
    ).toBe('Eldoret Municipality Block 7/1234');
    expect(
      sourceDetails({
        type: 'shareholding',
        details: { issuer: 'Kapsoya Traders Ltd' },
        source: { kind: 'brs', suggestionId, at: AT },
      })?.reference,
    ).toBe('Kapsoya Traders Ltd');
  });

  it('names the document an item was read from', () => {
    expect(
      sourceDetails({
        type: 'vehicle',
        details: { registration: 'KCB 782M' },
        attachments: [
          { attachmentId: 'a', uploadId: 'u', fileName: 'logbook-KCB782M.pdf', sha256: 'x' },
        ],
        source: { kind: 'document', suggestionId, at: AT },
      }),
    ).toEqual({ kind: 'document', at: AT, reference: 'logbook-KCB782M.pdf' });
  });

  it('falls back to the identifier when a document item has several files', () => {
    expect(
      sourceDetails({
        type: 'vehicle',
        details: { registration: 'KCB 782M' },
        attachments: [
          { attachmentId: 'a', uploadId: 'u', fileName: 'logbook-KCB782M.pdf', sha256: 'x' },
          { attachmentId: 'b', uploadId: 'v', fileName: 'insurance.pdf', sha256: 'y' },
        ],
        source: { kind: 'document', suggestionId, at: AT },
      })?.reference,
    ).toBe('KCB 782M');
  });

  it('leaves the identifier out when the item has none', () => {
    expect(
      sourceDetails({
        type: 'salary-emoluments',
        source: { kind: 'kra', suggestionId, at: AT },
      }),
    ).toEqual({ kind: 'kra', at: AT, reference: undefined });
  });

  it('ignores a source it does not know', () => {
    expect(
      sourceDetails({
        type: 'cash',
        source: { kind: 'elsewhere' as 'kra', suggestionId, at: AT },
      }),
    ).toBeNull();
  });
});
