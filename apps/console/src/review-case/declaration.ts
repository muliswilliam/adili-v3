import { countryName, countyName, formatDate } from '@adili/ui';

import {
  ASSET_TYPE_LABELS,
  CATEGORY_LABELS,
  EMPLOYMENT_NATURE_LABELS,
  INCOME_TYPE_LABELS,
  LIABILITY_TYPE_LABELS,
  MARITAL_STATUS_LABELS,
  RELATION_LABELS,
} from './labels';

/**
 * The declaration as filed, read from the `declaration.v1` document the case detail pulls from
 * the declarations service (spec 07a FE-3) into what the case view shows: First Schedule order,
 * each person's statement with its items, and the attachments. The contract types the document
 * as a loose object, so it is read defensively: a field that is missing or of the wrong type
 * reads as absent, and an item without an id is left out (nothing could point at it).
 */

export type Category = 'income' | 'assets' | 'liabilities';
export const CATEGORIES: readonly Category[] = ['income', 'assets', 'liabilities'];

export type Relation = 'declarant' | 'spouse' | 'child';

export interface DeclaredAttachment {
  uploadId: string;
  fileName: string;
}

export interface DeclaredItem {
  id: string;
  category: Category;
  /** The type in words: "Land", "Salary and emoluments". */
  type: string;
  /** The type as the schema has it, for the icon. */
  typeKey: string;
  description: string;
  /** Place, ownership and other details in one line: "Kampala, Uganda · Joint, 50% share". */
  detail: string;
  /** Kenya shillings, in cents. */
  kesCents: number;
  /** "Marked as changed": the declarant's change mark, in words, or null. */
  changeMark: string | null;
  attachments: DeclaredAttachment[];
}

export interface DeclaredStatement {
  personKey: string;
  relation: Relation;
  name: string;
  /** "Declarant", "Spouse", "Child". */
  relationLabel: string;
  nil: Record<Category, boolean>;
  items: Record<Category, DeclaredItem[]>;
  totals: Record<Category, number>;
}

export interface DeclaredPerson {
  id: string;
  name: string;
  line: string;
}

export interface DeclarationView {
  statementDate: string | null;
  incomePeriod: { from: string; to: string } | null;
  personal: { label: string; value: string }[];
  spouses: DeclaredPerson[];
  children: DeclaredPerson[];
  statements: DeclaredStatement[];
  /** Totals across the household, by category. */
  totals: Record<Category, number>;
  otherInformation: string[];
  attachments: (DeclaredAttachment & { itemId: string; label: string })[];
  declaredAt: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function arrayOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** "Wanjiku Njeri Kamau": first, other and surname, as a person is addressed. */
export function personName(value: unknown): string {
  if (!isRecord(value)) return '';
  return [value.firstName, value.otherNames, value.surname]
    .map(text)
    .filter((part) => part.length > 0)
    .join(' ');
}

export function relationOf(personKey: string): Relation {
  if (personKey.startsWith('spouse:')) return 'spouse';
  if (personKey.startsWith('child:')) return 'child';
  return 'declarant';
}

function placeOf(location: unknown): string {
  if (!isRecord(location)) return '';
  if (location.inKenya === false) {
    const country = text(location.country);
    return [text(location.detail), country ? countryName(country) : 'Outside Kenya']
      .filter(Boolean)
      .join(', ');
  }
  const county = text(location.county);
  return [text(location.detail), county ? countyName(county) : ''].filter(Boolean).join(', ');
}

function ownershipOf(joint: unknown): string {
  if (!isRecord(joint)) return '';
  if (joint.isJoint !== true) return 'Sole';
  const share =
    typeof joint.sharePercent === 'number' ? `${String(joint.sharePercent)}% share` : '';
  return ['Joint', share].filter(Boolean).join(', ');
}

const TYPE_LABELS: Record<Category, Record<string, string>> = {
  income: INCOME_TYPE_LABELS,
  assets: ASSET_TYPE_LABELS,
  liabilities: LIABILITY_TYPE_LABELS,
};

const CHANGE_MARKS: Record<string, string> = {
  'value-change': 'Marked as changed',
  acquisition: 'Marked as acquired',
  disposal: 'Marked as disposed',
  'new-source': 'Marked as a new source',
  'source-ended': 'Marked as ended',
  settled: 'Marked as settled',
};

function changeMarkOf(change: unknown): string | null {
  if (!isRecord(change) || change.changed !== true) return null;
  return CHANGE_MARKS[text(change.kind)] ?? 'Marked as changed';
}

function centsOf(money: unknown): number {
  return isRecord(money) && typeof money.kesCents === 'number' ? money.kesCents : 0;
}

function itemOf(category: Category, raw: Record<string, unknown>): DeclaredItem | null {
  const id = text(raw.id);
  if (!id) return null;
  const typeKey = text(raw.type);
  const amount =
    category === 'assets' ? raw.value : category === 'income' ? raw.amount : raw.outstanding;
  const detail = [
    // The creditor, unless the description already names it.
    category === 'liabilities' && !text(raw.description).includes(text(raw.creditor))
      ? text(raw.creditor)
      : '',
    placeOf(raw.location),
    category === 'assets' ? ownershipOf(raw.joint) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    id,
    category,
    typeKey,
    type: TYPE_LABELS[category][typeKey] ?? CATEGORY_LABELS[category],
    description: text(raw.description),
    detail,
    kesCents: centsOf(amount),
    changeMark: changeMarkOf(raw.change),
    attachments: arrayOf(raw.attachments).flatMap((attachment) => {
      const uploadId = text(attachment.uploadId);
      return uploadId ? [{ uploadId, fileName: text(attachment.fileName) || 'Attachment' }] : [];
    }),
  };
}

const zero = (): Record<Category, number> => ({ income: 0, assets: 0, liabilities: 0 });

function statementOf(raw: Record<string, unknown>): DeclaredStatement | null {
  const personKey = text(raw.personKey);
  if (!personKey) return null;
  const relation = relationOf(personKey);
  const items = {
    income: arrayOf(raw.income).flatMap((item) => itemOf('income', item) ?? []),
    assets: arrayOf(raw.assets).flatMap((item) => itemOf('assets', item) ?? []),
    liabilities: arrayOf(raw.liabilities).flatMap((item) => itemOf('liabilities', item) ?? []),
  };
  const totals = zero();
  for (const category of CATEGORIES) {
    totals[category] = items[category].reduce((sum, item) => sum + item.kesCents, 0);
  }
  return {
    personKey,
    relation,
    name: personName(raw.personName),
    relationLabel: RELATION_LABELS[relation],
    nil: {
      income: raw.incomeNil === true,
      assets: raw.assetsNil === true,
      liabilities: raw.liabilitiesNil === true,
    },
    items,
    totals,
  };
}

function personalOf(officer: unknown): DeclarationView['personal'] {
  const o = isRecord(officer) ? officer : {};
  const name = isRecord(o.name) ? o.name : {};
  const birth = isRecord(o.birth) ? o.birth : {};
  const address = isRecord(o.address) ? o.address : {};
  const employment = isRecord(o.employment) ? o.employment : {};
  const nature = text(employment.nature);
  const natureLabel =
    nature === 'other'
      ? text(employment.natureOther) || 'Other'
      : (EMPLOYMENT_NATURE_LABELS[nature] ?? '');
  const date = text(birth.date);
  return [
    { label: 'Surname', value: text(name.surname) },
    { label: 'First name', value: text(name.firstName) },
    { label: 'Other names', value: text(name.otherNames) },
    { label: 'Date of birth', value: date ? formatDate(date) : '' },
    { label: 'Place of birth', value: text(birth.place) },
    { label: 'Marital status', value: MARITAL_STATUS_LABELS[text(o.maritalStatus)] ?? '' },
    { label: 'Postal address', value: text(address.postal) },
    { label: 'Physical address', value: text(address.physical) },
    { label: 'Designation', value: text(employment.designation) },
    { label: 'Reporting entity', value: text(employment.employer) },
    { label: 'Nature of employment', value: natureLabel },
  ];
}

function otherInformationOf(other: unknown): string[] {
  if (!isRecord(other)) return [];
  const lines: string[] = [];
  for (const change of arrayOf(other.materialChanges)) {
    const what = text(change.itemDescription);
    const explanation = text(change.explanation);
    if (explanation) lines.push(what ? `${what}: ${explanation}` : explanation);
  }
  const interests = isRecord(other.registrableInterests) ? other.registrableInterests : {};
  for (const directorship of arrayOf(interests.directorships)) {
    const company = text(directorship.company);
    if (company) {
      const role = text(directorship.role);
      const paid = directorship.remunerated === true ? 'remunerated' : 'not remunerated';
      lines.push(`Directorship: ${[company, role, paid].filter(Boolean).join(', ')}`);
    }
  }
  for (const membership of arrayOf(interests.memberships)) {
    const entity = text(membership.entity);
    if (entity) lines.push(`Membership: ${entity}`);
  }
  const dual = isRecord(interests.dualCitizenship) ? interests.dualCitizenship : {};
  if (dual.holds === true) {
    const country = text(dual.country);
    lines.push(`Dual citizenship${country ? `: ${countryName(country)}` : ''}`);
  }
  for (const pending of arrayOf(interests.pendingCases)) {
    const nature = text(pending.nature);
    if (nature) {
      lines.push(
        `Pending case: ${[nature, text(pending.forum), text(pending.reference)].filter(Boolean).join(', ')}`,
      );
    }
  }
  const free = text(other.freeText).trim();
  if (free) lines.push(free);
  return lines;
}

/** The document as the case view shows it, or null when it is not a declaration it can read. */
export function readDeclaration(document: Record<string, unknown> | null): DeclarationView | null {
  if (document?.schemaVersion !== 'declaration.v1') return null;
  const statements = arrayOf(document.statements).flatMap((raw) => statementOf(raw) ?? []);
  const totals = zero();
  for (const statement of statements) {
    for (const category of CATEGORIES) totals[category] += statement.totals[category];
  }
  const period = isRecord(document.incomePeriod) ? document.incomePeriod : null;
  const spouses = isRecord(document.spouses) ? arrayOf(document.spouses.items) : [];
  const children = isRecord(document.children) ? arrayOf(document.children.items) : [];
  const attestation = isRecord(document.attestation) ? document.attestation : {};
  return {
    statementDate: text(document.statementDate) || null,
    incomePeriod:
      period && text(period.from) && text(period.to)
        ? { from: text(period.from), to: text(period.to) }
        : null,
    personal: personalOf(document.officer),
    spouses: spouses.map((spouse) => ({
      id: text(spouse.id),
      name: personName(spouse.name),
      line: [
        text(spouse.nationalId) ? 'National ID declared' : 'National ID not declared',
        spouse.separated === true ? 'separated' : '',
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    children: children.map((child) => ({
      id: text(child.id),
      name: personName(child.name),
      line: [
        text(child.dateOfBirth) ? `Born ${formatDate(text(child.dateOfBirth))}` : '',
        text(child.nationalId) ? 'national ID declared' : 'no national ID',
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    statements,
    totals,
    otherInformation: otherInformationOf(document.otherInformation),
    attachments: statements.flatMap((statement) =>
      CATEGORIES.flatMap((category) =>
        statement.items[category].flatMap((item) =>
          item.attachments.map((attachment) => ({
            ...attachment,
            itemId: item.id,
            label: [item.type, item.description, statement.name].filter(Boolean).join(' · '),
          })),
        ),
      ),
    ),
    declaredAt: text(attestation.declaredAt) || null,
  };
}

/** Where an item sits, for a flag's "concerns" line: "Assets · Land · Plot 1234 · John Otieno". */
export function itemLabel(view: DeclarationView, itemId: string): string | null {
  for (const statement of view.statements) {
    for (const category of CATEGORIES) {
      const item = statement.items[category].find((each) => each.id === itemId);
      if (item) {
        return [CATEGORY_LABELS[category], item.type, item.description, statement.name]
          .filter(Boolean)
          .join(' · ');
      }
    }
  }
  return null;
}

/** The statement of a person, by key. */
export function statementFor(view: DeclarationView, personKey: string): DeclaredStatement | null {
  return view.statements.find((each) => each.personKey === personKey) ?? null;
}

/**
 * The declarant's reporting entity in the declaration as filed (`officer.employment.employer`
 * in `declaration.v1`), for the case header and the letter's address block.
 */
export function reportingEntityOf(document: Record<string, unknown> | null): string | null {
  const declarant = document?.officer;
  if (!isRecord(declarant) || !isRecord(declarant.employment)) return null;
  const entity = declarant.employment.employer;
  return typeof entity === 'string' && entity ? entity : null;
}
