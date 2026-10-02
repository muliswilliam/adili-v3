/** review.yaml `Severity`, lowest first. */
export const SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * The wording of each deterministic flag (review.yaml `RuleId`), shared by the console and the
 * clarification letters. Flags are indicators for a reviewer's judgement, never findings, so the
 * texts say what was observed and what might explain it (Agenda Track 6).
 */
export const RULES = {
  'completeness-residual': {
    title: 'Form checks not met at submission',
    indicator:
      'The declaration was submitted with parts the form checks did not accept. It may simply need a correction.',
  },
  'no-previous-version': {
    title: 'First declaration on Adili',
    indicator:
      'There is no earlier declaration on Adili to compare with, so changes since the last one cannot be checked.',
  },
  'value-change-25': {
    title: 'Value changed by 25% or more',
    indicator:
      'The value of this item moved by at least a quarter since the previous declaration. The declarant may have explained it; the change alone is not a concern.',
  },
  'acquisition-unflagged': {
    title: 'New item not marked as new',
    indicator:
      'This item was not in the previous declaration and was not marked as an acquisition or a new source of income.',
  },
  'disposal-unflagged': {
    title: 'Item no longer declared, no disposal recorded',
    indicator:
      'This item was in the previous declaration but not this one, and no disposal, ended source or settlement is recorded in paragraph 9.',
  },
  'change-flag-mismatch': {
    title: 'Change marking differs from the comparison',
    indicator:
      'The declarant marked a change the comparison does not show, or the comparison shows a change of 25% or more that was not marked.',
  },
  'income-vs-asset-growth': {
    title: 'Assets grew faster than declared income',
    indicator:
      'Total declared assets grew by more than the total income declared for the period. Gifts, inheritance or revaluation can explain this.',
  },
  'nil-after-populated': {
    title: 'Declared nil after items were declared before',
    indicator:
      'This category is declared nil although the previous declaration listed items in it.',
  },
  'late-filing': {
    title: 'Submitted after the due date',
    indicator: 'This declaration was submitted after it was due.',
  },
  'foreign-holdings': {
    title: 'Income or assets outside Kenya',
    indicator:
      'The declaration lists income or assets outside Kenya, which the form asks to be declared (First Schedule, note 13).',
  },
  'joint-share-inconsistent': {
    title: 'Joint shares do not add up',
    indicator:
      'The shares declared for a jointly held asset across the household do not add up to 100%. A co-owner outside the household can explain this.',
  },
  // Registry cross-checks (spec 07b): what KRA, NTSA, BRS and ArdhiSasa hold against the form.
  'registry-parcel-undeclared': {
    title: 'Registered parcel not declared',
    indicator:
      "ArdhiSasa lists a parcel in this person's name that no declared land or building carries. A recent sale not yet registered, or a parcel held in trust, can explain this.",
  },
  'declared-parcel-not-found': {
    title: 'Declared parcel not in ArdhiSasa',
    indicator:
      'A declared parcel number is not among the parcels ArdhiSasa lists for this person. A typing difference or a transfer still in progress can explain this.',
  },
  'registry-vehicle-undeclared': {
    title: 'Registered vehicle not declared',
    indicator:
      "NTSA lists a vehicle in this person's name that no declared vehicle carries. A sale whose transfer was not yet registered can explain this.",
  },
  'declared-vehicle-not-found': {
    title: 'Declared vehicle not in NTSA',
    indicator:
      'A declared vehicle registration is not among the vehicles NTSA lists for this person. A typing difference or a vehicle registered in another name can explain this.',
  },
  'registry-directorship-undeclared': {
    title: 'Directorship or shareholding not declared',
    indicator:
      'BRS lists this person as a director or shareholder of a company the declaration does not mention. A role that ended but was not yet updated at BRS can explain this.',
  },
  'declared-company-not-found': {
    title: 'Declared company not in BRS',
    indicator:
      'A declared company registration number is not among the companies BRS lists for this person. A typing difference or a holding through a nominee can explain this.',
  },
  'directorship-employer-supplier': {
    title: "Company supplies the declarant's employer",
    indicator:
      "BRS lists this person as a director or shareholder of a company on the supplier list of the declarant's own employer. It may be a conflict of interest to look into, or one already managed.",
  },
  'kra-pin-missing': {
    title: 'No KRA PIN found',
    indicator:
      "KRA holds no PIN for this person's national ID. The PIN may be registered under another document.",
  },
  'kra-non-compliant': {
    title: 'Not tax compliant at KRA',
    indicator:
      'KRA reports this person as not tax compliant. Compliance may since have been restored.',
  },
  'kra-income-mismatch': {
    title: 'Income declared to KRA differs by 25% or more',
    indicator:
      'The annual income declared to KRA differs by at least a quarter from the income declared here for the same period. Exempt income or different periods can explain this.',
  },
  // What a registry check could not compare (spec 07b `info` notes): no score, no mismatch.
  'registry-parcel-number-missing': {
    title: 'Land declared without a parcel number',
    indicator:
      'This land carries no parcel number, so it could not be compared with the parcels ArdhiSasa lists for this person.',
  },
  'registry-vehicle-registration-missing': {
    title: 'Vehicle declared without a registration',
    indicator:
      'This vehicle carries no registration, so it could not be compared with the vehicles NTSA lists for this person.',
  },
  'registry-company-registration-missing': {
    title: 'Company declared without a registration number',
    indicator:
      'This company carries no registration number and its name is not one BRS lists for this person, so it could not be compared.',
  },
  'registry-company-dissolved': {
    title: 'Declared company dissolved at BRS',
    indicator:
      'BRS lists this declared company as dissolved. A holding declared before the dissolution was registered can explain this.',
  },
} as const satisfies Record<string, { title: string; indicator: string }>;

export type RuleId = keyof typeof RULES;
