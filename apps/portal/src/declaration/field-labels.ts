/**
 * The labels of the declaration's fields as its section screens show them, keyed by the field's
 * name in `declaration.v1`. The screens label their fields with these, and the summary names the
 * field of an issue with them, so the two never drift apart.
 */

/** An income, asset or liability item's own fields (the statement screens' item editor). */
export const ITEM_FIELD_LABELS = {
  description: 'Description',
  creditor: 'Creditor',
  location: 'Location',
  country: 'Country',
  county: 'County',
  joint: 'Jointly held',
  coOwner: 'Co-owner relationship',
  change: 'Changed since last declaration',
  explanation: 'Explanation',
} as const;

/** What a type of asset adds (`details`): land, a vehicle, securities, an account, a receivable. */
export const DETAIL_FIELD_LABELS = {
  parcelNumber: 'Parcel or plot number',
  size: 'Size',
  registration: 'Registration',
  makeModel: 'Make and model',
  issuer: 'Company or issuer',
  quantityOrPercent: 'Number or percentage',
  institution: 'Institution',
  accountType: 'Account type',
  debtor: 'Debtor',
} as const;

/** A person's fields on the personal details and household screens. */
export const PERSON_FIELD_LABELS = {
  dateOfBirth: 'Date of birth',
  nationalId: 'National ID',
  kraPin: 'KRA PIN',
  separationDate: 'Date of separation',
} as const;
