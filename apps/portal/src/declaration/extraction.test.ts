import { describe, expect, it } from 'vitest';

import type { LoadedSuggestion, LoadedSuggestionSet } from '../server/declarations.server';
import { DOCUMENT_KIND_LABELS } from './labels';
import {
  acceptedFields,
  clashes,
  defaultKind,
  DOCUMENT_KINDS,
  readingNotEnabledIn,
  levelOf,
  readingState,
  readSuggestion,
} from './extraction';
import { FAILURE_REASONS } from './copy';

function suggestion(overrides: Partial<LoadedSuggestion> = {}): LoadedSuggestion {
  return {
    id: '5a000000-0000-4000-8000-000000000001',
    setId: '5b000000-0000-4000-8000-000000000001',
    personKey: 'officer',
    sectionKey: 'statement:officer',
    itemType: 'vehicle',
    fields: { registration: 'KCB 782M', make: 'Toyota', model: 'Premio', year: 2015 },
    sourceRef: {
      documentKind: 'logbook',
      fields: [
        { name: 'registration', confidence: 0.97, page: 1 },
        { name: 'year', confidence: 0.41, page: 2 },
      ],
      warnings: ['Page 3 could not be read.'],
    },
    confidence: 0.7,
    matchItemId: null,
    status: 'new',
    acceptedItemId: null,
    ...overrides,
  };
}

function set(overrides: Partial<LoadedSuggestionSet> = {}): LoadedSuggestionSet {
  return {
    id: '5b000000-0000-4000-8000-000000000001',
    personKey: 'officer',
    source: 'document',
    status: 'ready',
    requestedAt: '2026-09-26T07:30:00Z',
    readyAt: '2026-09-26T07:31:00Z',
    verificationResultId: null,
    aiJobId: '5c000000-0000-4000-8000-000000000001',
    suggestions: [],
    ...overrides,
  };
}

describe('document kinds', () => {
  it('labels every kind the contract takes', () => {
    expect(DOCUMENT_KINDS.map((kind) => DOCUMENT_KIND_LABELS[kind])).toEqual([
      'Title deed',
      'Logbook',
      'Payslip',
      'Bank letter',
      'Share certificate',
      'Other',
    ]);
  });

  it('offers the kind that fits the item first', () => {
    expect(defaultKind('vehicle')).toBe('logbook');
    expect(defaultKind('land')).toBe('title-deed');
    expect(defaultKind('building')).toBe('title-deed');
    expect(defaultKind('shareholding')).toBe('share-certificate');
    expect(defaultKind('bank-account')).toBe('bank-letter');
    expect(defaultKind('loan')).toBe('bank-letter');
    expect(defaultKind('cash')).toBe('other');
    expect(defaultKind(undefined)).toBe('other');
  });
});

describe('readSuggestion', () => {
  it('reads fields, per-field confidence and pages, and warnings from sourceRef', () => {
    const reading = readSuggestion(suggestion());
    expect(reading.documentKind).toBe('logbook');
    expect(reading.warnings).toEqual(['Page 3 could not be read.']);
    expect(reading.fields).toEqual([
      {
        key: 'registration',
        label: 'Registration',
        value: 'KCB 782M',
        input: 'text',
        confidence: 0.97,
        page: 1,
      },
      { key: 'make', label: 'Make', value: 'Toyota', input: 'text', confidence: 0.7, page: null },
      { key: 'model', label: 'Model', value: 'Premio', input: 'text', confidence: 0.7, page: null },
      { key: 'year', label: 'Year', value: '2015', input: 'text', confidence: 0.41, page: 2 },
    ]);
    expect(reading.fields.map(levelOf)).toEqual(['high', 'medium', 'medium', 'low']);
  });

  it('shows land fields with the county and the description', () => {
    const reading = readSuggestion(
      suggestion({
        itemType: 'land',
        fields: { parcelNumber: 'Nakuru/Njoro/1187', county: '032', description: 'Farm' },
        sourceRef: {},
        confidence: null,
      }),
    );
    expect(reading.fields.map(({ key, label, input }) => [key, label, input])).toEqual([
      ['parcelNumber', 'Parcel or plot number', 'text'],
      ['county', 'County', 'county'],
      ['description', 'Description', 'text'],
    ]);
    expect(reading.fields.map(levelOf)).toEqual([null, null, null]);
  });

  it('leaves out what is malformed', () => {
    const reading = readSuggestion(
      suggestion({
        sourceRef: {
          documentKind: 'passport',
          fields: [
            'registration',
            { name: 'registration', confidence: 7, page: -1 },
            { confidence: 0.2 },
          ],
          warnings: [3, '', 'Stamp is smudged.'],
        },
        confidence: null,
      }),
    );
    expect(reading.documentKind).toBeNull();
    expect(reading.warnings).toEqual(['Stamp is smudged.']);
    expect(reading.fields[0]).toMatchObject({ confidence: null, page: null });
  });
});

describe('readingState', () => {
  it('follows the set', () => {
    expect(readingState(set({ status: 'pending' }))).toEqual({ status: 'reading' });
    expect(readingState(set({ status: 'not-enabled' }))).toEqual({ status: 'not-enabled' });
    const found = suggestion();
    expect(readingState(set({ suggestions: [found] }))).toEqual({
      status: 'ready',
      suggestion: found,
    });
  });

  it('fails with the reason a suggestion gives, or a generic one', () => {
    expect(readingState(set({ status: 'failed' }))).toEqual({
      status: 'failed',
      reason: FAILURE_REASONS.unknown,
    });
    expect(
      readingState(
        set({
          status: 'failed',
          suggestions: [suggestion({ status: 'superseded', sourceRef: { reason: 'too blurred' } })],
        }),
      ),
    ).toEqual({ status: 'failed', reason: 'too blurred' });
    expect(readingState(set({ status: 'ready', suggestions: [] }))).toMatchObject({
      status: 'failed',
    });
  });

  it('knows reading is off from a not-enabled document set only', () => {
    expect(readingNotEnabledIn([set({ status: 'not-enabled' })])).toBe(true);
    expect(readingNotEnabledIn([set({ source: 'ntsa', status: 'not-enabled' })])).toBe(false);
    expect(readingNotEnabledIn([set()])).toBe(false);
  });
});

describe('applying', () => {
  it('sends the suggestion fields with the trimmed edits over them', () => {
    expect(acceptedFields(suggestion(), { year: ' 2016 ', model: 'Premio' })).toEqual({
      registration: 'KCB 782M',
      make: 'Toyota',
      model: 'Premio',
      year: '2016',
    });
  });

  it('lists the values the declarant entered that differ', () => {
    const item = {
      description: 'Toyota Premio',
      details: { registration: 'KCB 782N', makeModel: '' },
    };
    const met = clashes(item, suggestion().fields, 'vehicle');
    expect(met.map(({ entry, existing }) => [entry.label, existing])).toEqual([
      ['Registration', 'KCB 782N'],
    ]);
  });
});
