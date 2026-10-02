import type { DeclarationV1 } from '@adili/forms';

/**
 * What a grant lets out of a submitted version (spec 10, Act s.36): the household members and
 * the sections of the access scope, cut from the `declaration.v1` document. Pure, so the cut is
 * tested apart from the decryption and the read around it.
 *
 * The sections map onto the document so that nothing outside the scope travels:
 * - `bio`: the officer's particulars (`officer`), and the particulars of the included household
 *   members (`spouses`, `children`) without their national IDs, KRA PINs or dates of birth;
 * - `income`, `assets`, `liabilities`: those parts of the included persons' statements
 *   (`statements[]`, each with its person, statement date, income period and knowledge
 *   limitation), and the declaration's income period with `income`;
 * - `other`: other information (`otherInformation`), its material changes limited to the
 *   included persons.
 * The document's identity (`schemaVersion`, `type`, `statementDate`) and its `attestation` always
 * come along: they say what was declared and when, nothing of its content.
 */

export const DISCLOSURE_SECTIONS = ['bio', 'income', 'assets', 'liabilities', 'other'] as const;
export type DisclosureSection = (typeof DISCLOSURE_SECTIONS)[number];

export interface DisclosureScope {
  includeSpouses: boolean;
  includeChildren: boolean;
  sections: readonly DisclosureSection[];
}

type Statement = DeclarationV1['statements'][number];
type Spouse = DeclarationV1['spouses']['items'][number];
type Child = DeclarationV1['children']['items'][number];

/**
 * A spouse as disclosed: who they are and whether separated, never their national ID or KRA PIN
 * (architecture §8, data minimisation: the recipient needs neither, and they would travel
 * through the access service and the issue payload).
 */
export type DisclosedSpouse = Omit<Spouse, 'nationalId' | 'kraPin'>;

/** A child as disclosed: who they are, never their national ID or date of birth. */
export type DisclosedChild = Omit<Child, 'nationalId' | 'dateOfBirth'>;

/** A statement as disclosed: whose and for when, and only the granted sections of it. */
export type DisclosedStatement = Pick<
  Statement,
  'personKey' | 'personName' | 'statementDate' | 'incomePeriod'
> &
  Partial<
    Pick<
      Statement,
      | 'incomeNil'
      | 'income'
      | 'assetsNil'
      | 'assets'
      | 'liabilitiesNil'
      | 'liabilities'
      | 'knowledgeLimitation'
    >
  >;

/** The subset of a `declaration.v1` document a scope discloses; absent keys were not granted. */
export interface DisclosedContent {
  schemaVersion: DeclarationV1['schemaVersion'];
  type: DeclarationV1['type'];
  statementDate: DeclarationV1['statementDate'];
  incomePeriod?: DeclarationV1['incomePeriod'];
  officer?: DeclarationV1['officer'];
  spouses?: { none: boolean; items: DisclosedSpouse[] };
  children?: { none: boolean; items: DisclosedChild[] };
  statements?: DisclosedStatement[];
  otherInformation?: DeclarationV1['otherInformation'];
  attestation: DeclarationV1['attestation'];
}

/** Whether the scope includes the person whose key it is: the officer always. */
export function includesPerson(scope: DisclosureScope, personKey: string): boolean {
  if (personKey === 'officer') return true;
  if (personKey.startsWith('spouse:')) return scope.includeSpouses;
  if (personKey.startsWith('child:')) return scope.includeChildren;
  return false;
}

/** The part of the document the scope discloses, and nothing else. */
export function disclose(document: DeclarationV1, scope: DisclosureScope): DisclosedContent {
  const has = (section: DisclosureSection) => scope.sections.includes(section);
  const financial = has('income') || has('assets') || has('liabilities');
  return {
    schemaVersion: document.schemaVersion,
    type: document.type,
    statementDate: document.statementDate,
    ...(has('income') ? { incomePeriod: document.incomePeriod } : {}),
    ...(has('bio') ? { officer: document.officer } : {}),
    ...(has('bio') && scope.includeSpouses
      ? {
          spouses: {
            none: document.spouses.none,
            items: document.spouses.items.map(discloseSpouse),
          },
        }
      : {}),
    ...(has('bio') && scope.includeChildren
      ? {
          children: {
            none: document.children.none,
            items: document.children.items.map(discloseChild),
          },
        }
      : {}),
    ...(financial
      ? {
          statements: document.statements
            .filter((statement) => includesPerson(scope, statement.personKey))
            .map((statement) => discloseStatement(statement, has)),
        }
      : {}),
    ...(has('other')
      ? {
          otherInformation: {
            ...document.otherInformation,
            materialChanges: document.otherInformation.materialChanges.filter(
              (change) => change.personKey === undefined || includesPerson(scope, change.personKey),
            ),
          },
        }
      : {}),
    attestation: document.attestation,
  };
}

function discloseStatement(
  statement: Statement,
  has: (section: DisclosureSection) => boolean,
): DisclosedStatement {
  return {
    personKey: statement.personKey,
    personName: statement.personName,
    statementDate: statement.statementDate,
    incomePeriod: statement.incomePeriod,
    ...(has('income') ? { incomeNil: statement.incomeNil, income: statement.income } : {}),
    ...(has('assets') ? { assetsNil: statement.assetsNil, assets: statement.assets } : {}),
    ...(has('liabilities')
      ? { liabilitiesNil: statement.liabilitiesNil, liabilities: statement.liabilities }
      : {}),
    ...(statement.knowledgeLimitation === undefined
      ? {}
      : { knowledgeLimitation: statement.knowledgeLimitation }),
  };
}

/** Listed field by field, so that a field added to `declaration.v1` is not disclosed by default. */
function discloseSpouse(spouse: Spouse): DisclosedSpouse {
  return {
    id: spouse.id,
    name: spouse.name,
    ...(spouse.occupationSector === undefined ? {} : { occupationSector: spouse.occupationSector }),
    separated: spouse.separated,
    ...(spouse.separationDate === undefined ? {} : { separationDate: spouse.separationDate }),
  };
}

function discloseChild(child: Child): DisclosedChild {
  return {
    id: child.id,
    name: child.name,
    includedAtStatementDate: child.includedAtStatementDate,
  };
}
