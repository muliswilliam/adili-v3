import { validateFormK } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import {
  type AccountParticulars,
  DECLARATION_TEXT,
  draftFrom,
  emptyDraft,
  firstInvalidStep,
  type FormKDraft,
  formKDraftSchema,
  placeServerErrors,
  stepErrors,
  toFormK,
} from './form-k';

const ACCOUNT: AccountParticulars = {
  name: 'Mercy Wanjiku Kamau',
  identityDocument: { kind: 'national-id', number: '28841276', country: null },
  telephone: '+254722418903',
  email: 'mercy.kamau@example.com',
};

const AT = new Date('2026-10-02T07:00:00Z');

function complete(): FormKDraft {
  return {
    commission: 'psc',
    postalAddress: 'P.O. Box 49010-00100, Nairobi',
    physicalAddress: 'Othaya Road, Kileleshwa, Nairobi',
    occupation: 'Journalist',
    officer: {
      name: 'Peter Mwangi Kamau',
      entity: 'State Department for Housing and Urban Development',
      workStation: 'Ardhi House, Nairobi',
      personnelFileNumber: '',
    },
    information: {
      informationSought: 'Assets declared in the 2026 initial declaration.',
      reason: 'The officer approved housing tenders to a company linked to them.',
      otherInformation: '',
    },
    scope: {
      years: [2026, 2025],
      includeSpouses: true,
      includeChildren: false,
      sections: ['assets', 'liabilities'],
    },
    declared: true,
  };
}

/** What the wizard lets through, and whether `form-k.v1` accepts the document it becomes. */
function verdicts(draft: FormKDraft) {
  const checked = formKDraftSchema.safeParse(draft);
  const wizard = checked.success;
  // The document the draft would make even when the wizard refuses it: trimmed like the wizard.
  const document = toFormK(
    {
      ...draft,
      commission: draft.commission ?? '',
      postalAddress: draft.postalAddress.trim(),
      physicalAddress: draft.physicalAddress.trim(),
      occupation: draft.occupation.trim(),
      officer: {
        name: draft.officer.name.trim(),
        entity: draft.officer.entity.trim(),
        workStation: draft.officer.workStation.trim(),
        personnelFileNumber: draft.officer.personnelFileNumber.trim(),
      },
      information: {
        informationSought: draft.information.informationSought.trim(),
        reason: draft.information.reason.trim(),
        otherInformation: draft.information.otherInformation.trim(),
      },
      declared: true,
    },
    ACCOUNT,
    AT,
  );
  return { wizard, schema: validateFormK(document).ok };
}

const text = (length: number) => 'x'.repeat(length);

type Edit = (draft: FormKDraft, value: string) => FormKDraft;

/** Each free-text field of the draft with its `form-k.v1` bounds. */
const FIELDS: { name: string; min: number; max: number; edit: Edit }[] = [
  { name: 'postalAddress', min: 3, max: 200, edit: (d, v) => ({ ...d, postalAddress: v }) },
  { name: 'physicalAddress', min: 3, max: 200, edit: (d, v) => ({ ...d, physicalAddress: v }) },
  { name: 'occupation', min: 2, max: 100, edit: (d, v) => ({ ...d, occupation: v }) },
  {
    name: 'officer.name',
    min: 2,
    max: 200,
    edit: (d, v) => ({ ...d, officer: { ...d.officer, name: v } }),
  },
  {
    name: 'officer.entity',
    min: 2,
    max: 200,
    edit: (d, v) => ({ ...d, officer: { ...d.officer, entity: v } }),
  },
  {
    name: 'officer.workStation',
    min: 0,
    max: 200,
    edit: (d, v) => ({ ...d, officer: { ...d.officer, workStation: v } }),
  },
  {
    name: 'officer.personnelFileNumber',
    min: 0,
    max: 30,
    edit: (d, v) => ({ ...d, officer: { ...d.officer, personnelFileNumber: v } }),
  },
  {
    name: 'information.informationSought',
    min: 10,
    max: 4000,
    edit: (d, v) => ({ ...d, information: { ...d.information, informationSought: v } }),
  },
  {
    name: 'information.reason',
    min: 10,
    max: 4000,
    edit: (d, v) => ({ ...d, information: { ...d.information, reason: v } }),
  },
  {
    name: 'information.otherInformation',
    min: 0,
    max: 4000,
    edit: (d, v) => ({ ...d, information: { ...d.information, otherInformation: v } }),
  },
];

describe('S17: the wizard checks mirror form-k.v1', () => {
  it('turns a complete draft into a document form-k.v1 accepts', () => {
    const checked = formKDraftSchema.parse(complete());
    const document = toFormK(checked, ACCOUNT, AT);
    expect(validateFormK(document)).toEqual({ ok: true, value: document });
    expect(document.partIV).toEqual({ text: DECLARATION_TEXT, declaredAt: AT.toISOString() });
    expect(document.scope.years).toEqual([2025, 2026]);
    expect(document.partII).not.toHaveProperty('personnelFileNumber');
  });

  it.each(FIELDS)('agrees with form-k.v1 on the length of $name', ({ min, max, edit }) => {
    const lengths = [...(min > 0 ? [min - 1, min] : [0]), max, max + 1];
    for (const length of lengths) {
      const { wizard, schema } = verdicts(edit(complete(), text(length)));
      expect({ length, wizard }).toEqual({ length, wizard: schema });
    }
  });

  it('counts the trimmed text, as the document is filed trimmed', () => {
    const padded = edit(complete(), `  ${text(8)}  `);
    expect(verdicts(padded)).toEqual({ wizard: false, schema: false });
    function edit(draft: FormKDraft, value: string): FormKDraft {
      return { ...draft, information: { ...draft.information, reason: value } };
    }
  });

  it('agrees on the scope: at least one year from 2025 and one section, none twice', () => {
    const scoped = (scope: Partial<FormKDraft['scope']>) =>
      verdicts({ ...complete(), scope: { ...complete().scope, ...scope } });
    expect(scoped({ years: [] })).toEqual({ wizard: false, schema: false });
    expect(scoped({ years: [2024] })).toEqual({ wizard: false, schema: false });
    expect(scoped({ years: [2025, 2025] })).toEqual({ wizard: false, schema: false });
    expect(scoped({ sections: [] })).toEqual({ wizard: false, schema: false });
    expect(scoped({ sections: ['bio', 'bio'] })).toEqual({ wizard: false, schema: false });
    expect(scoped({ years: [2025], sections: ['other'] })).toEqual({ wizard: true, schema: true });
  });

  it('agrees on the Commission key', () => {
    expect(verdicts({ ...complete(), commission: 'cpsb022' })).toEqual({
      wizard: true,
      schema: true,
    });
    expect(verdicts({ ...complete(), commission: 'PSC' })).toEqual({
      wizard: false,
      schema: false,
    });
  });

  it('carries a passport with its issuing country, a national ID without one', () => {
    const checked = formKDraftSchema.parse(complete());
    const passport = toFormK(
      checked,
      { ...ACCOUNT, identityDocument: { kind: 'passport', number: 'G2847193', country: 'GH' } },
      AT,
    );
    expect(passport.partI.identityDocument).toEqual({
      kind: 'passport',
      number: 'G2847193',
      country: 'GH',
    });
    expect(validateFormK(passport).ok).toBe(true);
    expect(toFormK(checked, ACCOUNT, AT).partI.identityDocument).toEqual({
      kind: 'national-id',
      number: '28841276',
    });
  });
});

describe('stepErrors', () => {
  it('names each missing field of a step with its copy', () => {
    expect(stepErrors('particulars', emptyDraft())).toEqual({
      postalAddress: 'Enter your postal address.',
      physicalAddress: 'Enter your physical address.',
      occupation: 'Enter your occupation.',
    });
    expect(stepErrors('officer', emptyDraft())).toEqual({
      'officer.name': 'Enter the officer’s full name.',
      'officer.entity': 'Enter the entity the officer works for.',
    });
    expect(stepErrors('scope', emptyDraft())).toEqual({
      'scope.years': 'Choose at least one declaration year.',
      'scope.sections': 'Choose at least one section.',
    });
    expect(stepErrors('declare', emptyDraft())).toEqual({
      declared: 'Tick the declaration to submit your request.',
    });
  });

  it('says when a long answer is over 4,000 characters', () => {
    const draft = complete();
    draft.information.reason = text(4001);
    expect(stepErrors('information', draft)).toEqual({
      'information.reason': 'Keep this to 4,000 characters or fewer.',
    });
  });

  it('finds the first step that needs attention', () => {
    expect(firstInvalidStep(emptyDraft())).toBe('commission');
    expect(firstInvalidStep({ ...complete(), declared: false })).toBe('declare');
    expect(firstInvalidStep(complete())).toBeNull();
  });
});

describe('placeServerErrors', () => {
  it('puts each path the service refused on its step and field', () => {
    expect(
      placeServerErrors(['partII.name', 'scope.years.0', 'partIII.reason', 'partI.occupation']),
    ).toEqual({
      steps: ['particulars', 'officer', 'information', 'scope'],
      errors: {
        occupation: 'Enter your occupation.',
        'officer.name': 'Enter the officer’s full name.',
        'information.reason': 'Give your reason (at least 10 characters).',
        'scope.years': 'Choose at least one declaration year.',
      },
    });
  });

  it('lands account particulars on the particulars step without a field', () => {
    expect(placeServerErrors(['partI.telephone'])).toEqual({ steps: ['particulars'], errors: {} });
    expect(placeServerErrors(['responsibleCommission'])).toEqual({
      steps: ['commission'],
      errors: { commission: 'Choose the Commission.' },
    });
    expect(placeServerErrors(['meta.reference', ''])).toEqual({ steps: [], errors: {} });
  });
});

describe('draftFrom', () => {
  it('starts a new draft from an earlier Form K, undeclared', () => {
    const document = toFormK(formKDraftSchema.parse(complete()), ACCOUNT, AT);
    expect(draftFrom(document)).toEqual({
      ...complete(),
      scope: { ...complete().scope, years: [2025, 2026] },
      declared: false,
    });
  });
});
