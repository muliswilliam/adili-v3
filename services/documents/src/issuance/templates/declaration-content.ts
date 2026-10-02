import {
  type AssetItem,
  type ChangeFlag,
  COUNTIES,
  COUNTRIES,
  DeclarationSchema,
  type DeclarationV1,
  type IncomeItem,
  type LiabilityItem,
  type Location,
  type Money,
  type PersonName,
  type Statement,
} from '@adili/forms';
import { z } from 'zod';

import { esc, formatDate, formatDateTime, INK, LINE, MUTED, SOFT } from './page.js';

/**
 * A `declaration.v1` document as issued documents print it: the whole of a submitted version
 * (a certified copy) or the part of it a grant discloses (an access package).
 */

const declaration = DeclarationSchema.shape;
const statement = declaration.statements.element.shape;

/**
 * A statement (paragraph 8) with only the granted sections: income, assets and liabilities are
 * each present with their nil flag, or absent when the section was not granted.
 */
const disclosedStatement = z.strictObject({
  personKey: statement.personKey,
  personName: statement.personName,
  statementDate: statement.statementDate,
  incomePeriod: statement.incomePeriod,
  incomeNil: statement.incomeNil.optional(),
  income: statement.income.optional(),
  assetsNil: statement.assetsNil.optional(),
  assets: statement.assets.optional(),
  liabilitiesNil: statement.liabilitiesNil.optional(),
  liabilities: statement.liabilities.optional(),
  knowledgeLimitation: statement.knowledgeLimitation,
});

/**
 * The household members a grant discloses: who they are, never their national IDs, KRA PINs or
 * dates of birth (architecture §8, data minimisation). Strict: a payload that carries them is
 * refused.
 */
const disclosedSpouses = z.strictObject({
  none: declaration.spouses.shape.none,
  items: z.array(declaration.spouses.shape.items.element.omit({ nationalId: true, kraPin: true })),
});
const disclosedChildren = z.strictObject({
  none: declaration.children.shape.none,
  items: z.array(
    declaration.children.shape.items.element.omit({ nationalId: true, dateOfBirth: true }),
  ),
});

/**
 * The part of a `declaration.v1` document a grant discloses (spec 10), as the declarations
 * service cuts it: the document's identity and attestation always; `officer` (with `spouses`
 * and `children` when included) only with bio; `statements` of the included persons with only
 * their granted sections (and the income period with income) only with a financial section;
 * `otherInformation` only with other. An absent key was not granted.
 */
export const disclosedDeclarationSchema = z
  .strictObject({
    schemaVersion: declaration.schemaVersion,
    type: declaration.type,
    statementDate: declaration.statementDate,
    incomePeriod: declaration.incomePeriod.optional(),
    officer: declaration.officer.optional(),
    spouses: disclosedSpouses.optional(),
    children: disclosedChildren.optional(),
    statements: z.array(disclosedStatement).optional(),
    otherInformation: declaration.otherInformation.optional(),
    attestation: declaration.attestation,
  })
  .meta({
    description:
      'The declaration.v1 document cut to the granted scope: always schemaVersion, type, statementDate and attestation; with bio, officer (and spouses, children when included, without their national IDs, KRA PINs or dates of birth); with income, assets or liabilities, statements of the included persons holding only those parts (incomePeriod too with income); with other, otherInformation. An absent key was not granted',
  });

export type DisclosedDeclaration = z.infer<typeof disclosedDeclarationSchema>;
type DisclosedStatement = z.infer<typeof disclosedStatement>;

export interface ContentOptions {
  /**
   * Print household members' national ID numbers and KRA PINs: on the declarant's own copy,
   * never on a disclosure to someone else.
   */
  householdIdentifiers: boolean;
  /**
   * The Commission that holds the declaration. The biodata names it, rather than by the tenant
   * key the declaration stores (`responsibleCommission`, e.g. `psc`).
   */
  commission: { slug: string; name: string; issuerCode: string };
}

/** Styles of the rendered content, for the template's stylesheet. */
export const CONTENT_STYLES = `
.sec{margin:6mm 0 0}
.sec h2{font-size:11.5pt;font-weight:700;margin:0 0 2mm;padding-bottom:1.2mm;border-bottom:0.35mm solid ${INK};break-after:avoid}
.sec h3{font-size:10pt;font-weight:700;margin:4mm 0 1.5mm;break-after:avoid}
.sec h4{font-size:8.6pt;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin:3mm 0 1mm;break-after:avoid}
.kv{display:grid;grid-template-columns:44mm 1fr;margin:0}
.kv dt,.kv dd{margin:0;padding:1.3mm 0;border-bottom:0.25mm solid ${LINE}}
.kv dt{color:${MUTED}}
table.items{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.4pt;margin:0 0 1mm}
table.items.c4 th:nth-child(1){width:20%}
table.items.c4 th:nth-child(2){width:40%}
table.items.c4 th:nth-child(3){width:22%}
table.items.c4 th:nth-child(4){width:18%}
table.items th{text-align:left;font-weight:600;color:${MUTED};font-size:7.4pt;letter-spacing:0.04em;text-transform:uppercase;padding:1.2mm 1.5mm;border-bottom:0.35mm solid ${INK}}
table.items td{padding:1.4mm 1.5mm;border-bottom:0.25mm solid ${LINE};vertical-align:top}
table.items tr{break-inside:avoid}
table.items .num{text-align:right;white-space:nowrap}
.note{color:${SOFT};font-size:7.8pt;margin-top:0.6mm}
.nil{color:${SOFT};font-style:italic;margin:0 0 1mm}`;

const INCOME_TYPES: Record<IncomeItem['type'], string> = {
  'salary-emoluments': 'Salary and emoluments',
  allowances: 'Allowances',
  business: 'Business',
  rent: 'Rent',
  'dividends-interest': 'Dividends and interest',
  pension: 'Pension',
  farming: 'Farming',
  consultancy: 'Consultancy',
  other: 'Other',
};

const ASSET_TYPES: Record<AssetItem['type'], string> = {
  land: 'Land',
  building: 'Building',
  vehicle: 'Vehicle',
  securities: 'Securities',
  shareholding: 'Shareholding',
  'bank-account': 'Bank account',
  cash: 'Cash',
  receivable: 'Receivable',
  other: 'Other',
};

const LIABILITY_TYPES: Record<LiabilityItem['type'], string> = {
  mortgage: 'Mortgage',
  loan: 'Loan',
  guarantee: 'Guarantee',
  other: 'Other',
};

const CHANGE_KINDS: Record<NonNullable<ChangeFlag['kind']>, string> = {
  'value-change': 'Value changed',
  acquisition: 'Acquired',
  disposal: 'Disposed of',
  'new-source': 'New source',
  'source-ended': 'Source ended',
  settled: 'Settled',
};

const MATERIAL_CHANGE_KINDS: Record<
  DeclarationV1['otherInformation']['materialChanges'][number]['kind'],
  string
> = {
  ...CHANGE_KINDS,
  'marital-status': 'Marital status',
  directorship: 'Directorship',
  membership: 'Membership',
};

const MARITAL_STATUSES: Record<DeclarationV1['officer']['maritalStatus'], string> = {
  single: 'Single',
  married: 'Married',
  separated: 'Separated',
  divorced: 'Divorced',
  widowed: 'Widowed',
};

const EMPLOYMENT_NATURES: Record<DeclarationV1['officer']['employment']['nature'], string> = {
  permanent: 'Permanent',
  temporary: 'Temporary',
  contract: 'Contract',
  other: 'Other',
};

const MEMBERSHIP_KINDS: Record<
  DeclarationV1['otherInformation']['registrableInterests']['memberships'][number]['kind'],
  string
> = {
  company: 'Company',
  partnership: 'Partnership',
  society: 'Society',
  club: 'Club',
  foundation: 'Foundation',
  trust: 'Trust',
  other: 'Other',
};

const COUNTY_NAMES = new Map(COUNTIES.map((county) => [county.code, county.name]));
const COUNTRY_NAMES = new Map(COUNTRIES.map((country) => [country.code, country.name]));

/** `Jane Wanjiru Kamau`. */
export function fullName(name: PersonName): string {
  return [name.firstName, name.otherNames, name.surname].filter(Boolean).join(' ');
}

const amount = (value: number, digits: number) =>
  value.toLocaleString('en-KE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** `KES 1,234,567.00`. */
export function kes(value: Money): string {
  return `KES ${amount(value.kesCents / 100, 2)}`;
}

/** `USD 10,000.00`, the amount as declared in another currency; null for one in shillings. */
export function originalAmount(value: Money): string | null {
  if (!value.original) return null;
  const { currency, minorUnits } = value.original;
  const digits =
    new Intl.NumberFormat('en-KE', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return `${currency} ${amount(minorUnits / 10 ** digits, digits)}`;
}

/** An amount cell: shillings, with the amount as declared in another currency under it. */
function moneyCell(value: Money): string {
  const original = originalAmount(value);
  return `<td class="num">${esc(kes(value))}${original ? `<div class="note">${esc(original)}</div>` : ''}</td>`;
}

function place(location: Location): string {
  const where = location.inKenya
    ? `${location.county ? `${COUNTY_NAMES.get(location.county) ?? location.county} County, ` : ''}Kenya`
    : (COUNTRY_NAMES.get(location.country ?? '') ?? location.country ?? 'Outside Kenya');
  return location.detail ? `${location.detail}, ${where}` : where;
}

function change(flag: ChangeFlag): string {
  if (!flag.changed || !flag.kind) return '';
  const explanation = flag.explanation ? `: ${esc(flag.explanation)}` : '';
  return `<div class="note">${CHANGE_KINDS[flag.kind]}${explanation}</div>`;
}

function attachments(item: { attachments?: { fileName: string }[] }): string {
  const files = item.attachments ?? [];
  if (files.length === 0) return '';
  return `<div class="note">Supporting documents: ${files.map((file) => esc(file.fileName)).join(', ')}</div>`;
}

function rows(entries: [string, string | undefined | null][]): string {
  return entries
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([term, value]) => `<dt>${esc(term)}</dt><dd>${esc(value)}</dd>`)
    .join('');
}

function bio(officer: DeclarationV1['officer'], options: ContentOptions): string {
  const { employment } = officer;
  const { commission } = options;
  const responsibleCommission =
    employment.responsibleCommission === commission.slug
      ? `${commission.name} (${commission.issuerCode})`
      : employment.responsibleCommission;
  const nature =
    employment.nature === 'other' && employment.natureOther
      ? employment.natureOther
      : EMPLOYMENT_NATURES[employment.nature];
  const marital = officer.maritalStatusChange?.changed
    ? `${MARITAL_STATUSES[officer.maritalStatus]} (changed: ${officer.maritalStatusChange.explanation ?? ''})`
    : MARITAL_STATUSES[officer.maritalStatus];
  return `<section class="sec"><h2>Biodata</h2><dl class="kv">${rows([
    ['Name', fullName(officer.name)],
    ['Date of birth', formatDate(officer.birth.date)],
    ['Place of birth', officer.birth.place],
    ['Marital status', marital],
    ['Postal address', officer.address.postal],
    ['Physical address', officer.address.physical],
    ['Designation', employment.designation],
    ['Employer', employment.employer],
    ['Terms of employment', nature],
    ['Personnel file number', employment.personnelFileNumber],
    ['Job group', employment.jobGroup],
    ['Date of appointment', employment.appointmentDate && formatDate(employment.appointmentDate)],
    ['Work station', employment.workStation],
    ['Responsible Commission', responsibleCommission],
  ])}</dl></section>`;
}

/** A spouse as printed: a disclosed one has no national ID or KRA PIN. */
interface HouseholdSpouse {
  name: PersonName;
  nationalId?: string;
  kraPin?: string;
  separated: boolean;
  separationDate?: string;
}

/** A child as printed: a disclosed one has no national ID or date of birth. */
interface HouseholdChild {
  name: PersonName;
  nationalId?: string;
  dateOfBirth?: string;
}

function household(
  spouses: { none: boolean; items: readonly HouseholdSpouse[] } | undefined,
  children: { none: boolean; items: readonly HouseholdChild[] } | undefined,
  options: ContentOptions,
): string {
  if (!spouses && !children) return '';
  const id = (nationalId: string | undefined) =>
    options.householdIdentifiers && nationalId
      ? `<div class="note">ID ${esc(nationalId)}</div>`
      : '';
  const spouseRows = spouses?.items
    .map((spouse) => {
      const pin =
        options.householdIdentifiers && spouse.kraPin
          ? `<div class="note">KRA PIN ${esc(spouse.kraPin)}</div>`
          : '';
      const separated = spouse.separated
        ? `Separated${spouse.separationDate ? ` since ${esc(formatDate(spouse.separationDate))}` : ''}`
        : 'Married';
      return `<tr><td>${esc(fullName(spouse.name))}${id(spouse.nationalId)}${pin}</td><td>${separated}</td></tr>`;
    })
    .join('');
  // Dates of birth are on the declarant's own copy only.
  const birthDates = options.householdIdentifiers;
  const childRows = children?.items
    .map((child) => {
      const born = birthDates
        ? `<td>${child.dateOfBirth ? esc(formatDate(child.dateOfBirth)) : ''}</td>`
        : '';
      return `<tr><td>${esc(fullName(child.name))}${id(child.nationalId)}</td>${born}</tr>`;
    })
    .join('');
  const spouseTable = spouses
    ? `<h3>Spouses</h3>${spouses.none || !spouseRows ? '<p class="nil">None declared.</p>' : `<table class="items"><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody>${spouseRows}</tbody></table>`}`
    : '';
  const childTable = children
    ? `<h3>Children</h3>${children.none || !childRows ? '<p class="nil">None declared.</p>' : `<table class="items"><thead><tr><th>Name</th>${birthDates ? '<th>Date of birth</th>' : ''}</tr></thead><tbody>${childRows}</tbody></table>`}`
    : '';
  return `<section class="sec"><h2>Household</h2>${spouseTable}${childTable}</section>`;
}

function itemTable<TItem>(
  title: string,
  nil: boolean | undefined,
  items: TItem[] | undefined,
  columns: string[],
  row: (item: TItem) => string,
): string {
  if (items === undefined) return '';
  const body =
    nil || items.length === 0
      ? '<p class="nil">Nil.</p>'
      : `<table class="items c4"><thead><tr>${columns.map((column, index) => `<th${index === columns.length - 1 ? ' class="num"' : ''}>${column}</th>`).join('')}</tr></thead><tbody>${items.map(row).join('')}</tbody></table>`;
  return `<h4>${title}</h4>${body}`;
}

function statementOf(entry: DisclosedStatement | Statement): string {
  const income = itemTable(
    'Income',
    entry.incomeNil,
    entry.income,
    ['Type', 'Description', 'Location', 'Amount'],
    (item: IncomeItem) =>
      `<tr><td>${INCOME_TYPES[item.type]}</td><td>${esc(item.description)}${change(item.change)}${attachments(item)}</td><td>${esc(place(item.location))}</td>${moneyCell(item.amount)}</tr>`,
  );
  const assets = itemTable(
    'Assets',
    entry.assetsNil,
    entry.assets,
    ['Type', 'Description', 'Location', 'Value'],
    (item: AssetItem) => {
      const details = Object.values(item.details ?? {}).filter(Boolean);
      const joint = item.joint.isJoint
        ? `<div class="note">Jointly owned${item.joint.sharePercent === undefined ? '' : `, ${item.joint.sharePercent}% share`}${item.joint.coOwner ? ` with ${esc(item.joint.coOwner)}` : ''}</div>`
        : '';
      const detail = details.length ? `<div class="note">${esc(details.join(', '))}</div>` : '';
      return `<tr><td>${ASSET_TYPES[item.type]}</td><td>${esc(item.description)}${detail}${joint}${change(item.change)}${attachments(item)}</td><td>${esc(place(item.location))}</td>${moneyCell(item.value)}</tr>`;
    },
  );
  const liabilities = itemTable(
    'Liabilities',
    entry.liabilitiesNil,
    entry.liabilities,
    ['Type', 'Creditor', 'Description', 'Outstanding'],
    (item: LiabilityItem) =>
      `<tr><td>${LIABILITY_TYPES[item.type]}</td><td>${esc(item.creditor)}</td><td>${esc(item.description)}${change(item.change)}${attachments(item)}</td>${moneyCell(item.outstanding)}</tr>`,
  );
  const limitation = entry.knowledgeLimitation
    ? `<p class="note">To the best of the declarant's knowledge: ${esc(entry.knowledgeLimitation)}</p>`
    : '';
  const period = `Statement date ${esc(formatDate(entry.statementDate))}. Income from ${esc(formatDate(entry.incomePeriod.from))} to ${esc(formatDate(entry.incomePeriod.to))}.`;
  return `<h3>${esc(fullName(entry.personName))}</h3><p class="note">${period}</p>${income}${assets}${liabilities}${limitation}`;
}

/** `Income, assets and liabilities`, or the part of it the statements carry. */
function statementsTitle(entries: (DisclosedStatement | Statement)[]): string {
  const parts = [
    entries.some((entry) => entry.income) ? 'income' : null,
    entries.some((entry) => entry.assets) ? 'assets' : null,
    entries.some((entry) => entry.liabilities) ? 'liabilities' : null,
  ].filter((part): part is string => part !== null);
  const words =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function statements(entries: (DisclosedStatement | Statement)[]): string {
  const title = statementsTitle(entries);
  if (!title) return '';
  return `<section class="sec"><h2>${title}</h2>${entries.map(statementOf).join('')}</section>`;
}

function otherInformation(other: DeclarationV1['otherInformation'] | undefined): string {
  if (!other) return '';
  const { registrableInterests: interests } = other;
  const changes = other.materialChanges.length
    ? `<h4>Material changes</h4><table class="items"><thead><tr><th>Kind</th><th>Item</th><th>Explanation</th></tr></thead><tbody>${other.materialChanges.map((entry) => `<tr><td>${MATERIAL_CHANGE_KINDS[entry.kind]}</td><td>${esc(entry.itemDescription ?? '')}</td><td>${esc(entry.explanation)}</td></tr>`).join('')}</tbody></table>`
    : '';
  const directorships = interests.directorships.length
    ? `<h4>Directorships</h4><table class="items"><thead><tr><th>Company</th><th>Role</th><th>Remunerated</th></tr></thead><tbody>${interests.directorships.map((entry) => `<tr><td>${esc(entry.company)}${entry.change ? change(entry.change) : ''}</td><td>${esc(entry.role)}</td><td>${entry.remunerated ? 'Yes' : 'No'}</td></tr>`).join('')}</tbody></table>`
    : '';
  const memberships = interests.memberships.length
    ? `<h4>Memberships</h4><table class="items"><thead><tr><th>Entity</th><th>Kind</th></tr></thead><tbody>${interests.memberships.map((entry) => `<tr><td>${esc(entry.entity)}${entry.change ? change(entry.change) : ''}</td><td>${MEMBERSHIP_KINDS[entry.kind]}</td></tr>`).join('')}</tbody></table>`
    : '';
  const cases = interests.pendingCases.length
    ? `<h4>Pending cases</h4><table class="items"><thead><tr><th>Forum</th><th>Reference</th><th>Nature</th></tr></thead><tbody>${interests.pendingCases.map((entry) => `<tr><td>${esc(entry.forum)}</td><td>${esc(entry.reference)}</td><td>${esc(entry.nature)}</td></tr>`).join('')}</tbody></table>`
    : '';
  const { dualCitizenship: dual } = interests;
  const citizenship = dual.holds
    ? `Holds citizenship of ${COUNTRY_NAMES.get(dual.country ?? '') ?? dual.country ?? 'another country'}`
    : 'No other citizenship';
  const pending = dual.pendingApplication ? '; an application is pending' : '';
  const freeText = other.freeText ? `<h4>Other information</h4><p>${esc(other.freeText)}</p>` : '';
  return `<section class="sec"><h2>Other information</h2>${changes}${directorships}${memberships}${cases}<h4>Dual citizenship</h4><p>${esc(citizenship + pending)}.</p>${freeText}</section>`;
}

/** The declaration's parts present in `content`, in the First Schedule's order. */
export function declarationContent(
  content: DisclosedDeclaration | DeclarationV1,
  options: ContentOptions,
): string {
  return [
    content.officer ? bio(content.officer, options) : '',
    household(content.spouses, content.children, options),
    statements(content.statements ?? []),
    otherInformation(content.otherInformation),
  ].join('');
}

/** The attestation of a submitted version, as declared. */
export function attestation(content: Pick<DeclarationV1, 'attestation'>): string {
  const declared = content.attestation.declaredAt
    ? `<p class="note">Declared ${esc(formatDateTime(content.attestation.declaredAt))}.</p>`
    : '';
  return `<section class="sec"><h2>Declaration</h2><p>${esc(content.attestation.text)}</p>${declared}</section>`;
}
