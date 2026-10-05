/* Generated from @adili/schemas/forms/declaration.v1.json by scripts/generate-validators.ts. Do not edit. */
// @ts-nocheck: ajv standalone code, untyped JavaScript; validate.ts types its validators.
import { fullFormats } from 'ajv-formats/dist/formats.js';
function ucs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  let value;
  while (pos < len) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      // high surrogate, and there is a next character
      value = str.charCodeAt(pos);
      if ((value & 0xfc00) === 0xdc00) pos++; // low surrogate
    }
  }
  return length;
}
export const declaration = validate20;
const schema31 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://adili.go.ke/schemas/declaration.v1.json',
  title:
    'Declaration of Income, Assets and Liabilities (First Schedule, Conflict of Interest Act 2025)',
  description:
    'One declaration as submitted by a public officer: paragraphs 1-9 of the First Schedule. Amounts are integers in minor units (KES cents). Draft: spec 05.',
  type: 'object',
  required: [
    'schemaVersion',
    'type',
    'statementDate',
    'incomePeriod',
    'officer',
    'spouses',
    'children',
    'statements',
    'otherInformation',
    'attestation',
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 'declaration.v1' },
    type: { type: 'string', enum: ['initial', 'biennial', 'final'] },
    statementDate: { type: 'string', format: 'date' },
    incomePeriod: {
      type: 'object',
      required: ['from', 'to', 'fromSource'],
      additionalProperties: false,
      properties: {
        from: { type: 'string', format: 'date' },
        to: { type: 'string', format: 'date' },
        fromSource: {
          type: 'string',
          enum: ['declared', 'assumed'],
          description:
            'declared: previous statement date from an Adili declaration; assumed: no prior record on Adili, start derived from type',
        },
      },
    },
    officer: {
      type: 'object',
      description: 'Paragraphs 1-5',
      required: ['name', 'birth', 'maritalStatus', 'address', 'employment'],
      additionalProperties: false,
      properties: {
        name: { $ref: '#/$defs/PersonName' },
        birth: {
          type: 'object',
          required: ['date', 'place'],
          additionalProperties: false,
          properties: {
            date: { type: 'string', format: 'date' },
            place: { type: 'string', minLength: 2, maxLength: 100 },
          },
        },
        maritalStatus: {
          type: 'string',
          enum: ['single', 'married', 'separated', 'divorced', 'widowed'],
        },
        maritalStatusChange: { $ref: '#/$defs/MaritalStatusChange' },
        address: {
          type: 'object',
          required: ['postal', 'physical'],
          additionalProperties: false,
          properties: {
            postal: { type: 'string', minLength: 3, maxLength: 200 },
            physical: { type: 'string', minLength: 3, maxLength: 200 },
          },
        },
        employment: {
          type: 'object',
          required: ['designation', 'employer', 'nature', 'responsibleCommission'],
          additionalProperties: false,
          properties: {
            designation: { type: 'string', maxLength: 100 },
            employer: { type: 'string', maxLength: 200 },
            nature: { type: 'string', enum: ['permanent', 'temporary', 'contract', 'other'] },
            natureOther: { type: 'string', maxLength: 100 },
            responsibleCommission: {
              type: 'string',
              description: 'Tenant key of the Responsible Commission',
              pattern: '^[a-z][a-z0-9]{1,19}$',
            },
            personnelFileNumber: { type: 'string', maxLength: 30 },
            jobGroup: {
              type: 'string',
              maxLength: 40,
              description:
                "Pre-filled from the Commission's roster when it has one (spec 05b); editable",
            },
            appointmentDate: {
              type: 'string',
              format: 'date',
              description:
                "Date of appointment; pre-filled from the Commission's roster when it has one (spec 05b); editable",
            },
            workStation: {
              type: 'string',
              maxLength: 100,
              description:
                "Pre-filled from the Commission's roster when it has one (spec 05b); editable",
            },
          },
        },
      },
    },
    spouses: {
      type: 'object',
      description: 'Paragraph 6',
      required: ['none', 'items'],
      additionalProperties: false,
      properties: {
        none: { type: 'boolean', description: 'Explicit declaration that there is no spouse' },
        items: { type: 'array', items: { $ref: '#/$defs/Spouse' } },
      },
    },
    children: {
      type: 'object',
      description: 'Paragraph 7',
      required: ['none', 'items'],
      additionalProperties: false,
      properties: {
        none: {
          type: 'boolean',
          description: 'Explicit declaration that there are no dependent children under 18',
        },
        items: { type: 'array', items: { $ref: '#/$defs/Child' } },
      },
    },
    statements: {
      type: 'array',
      description:
        'Paragraph 8: one financial statement per person (officer, each spouse, each included child)',
      minItems: 1,
      items: { $ref: '#/$defs/Statement' },
    },
    otherInformation: {
      type: 'object',
      description: 'Paragraph 9; material changes per Regs r.21',
      required: ['materialChanges', 'registrableInterests', 'freeText'],
      additionalProperties: false,
      properties: {
        materialChanges: {
          type: 'array',
          description: 'Composed from flagged items and the marital status change',
          items: { $ref: '#/$defs/MaterialChangeEntry' },
        },
        registrableInterests: { $ref: '#/$defs/RegistrableInterests' },
        freeText: { type: 'string', maxLength: 4000 },
      },
    },
    attestation: {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: {
        text: {
          const:
            'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.',
        },
        declaredAt: { type: 'string', format: 'date-time' },
        reference: {
          type: 'string',
          description: 'Reference number issued at submission (slice 06)',
        },
      },
    },
  },
  $defs: {
    PersonName: {
      type: 'object',
      required: ['surname', 'firstName'],
      additionalProperties: false,
      properties: {
        surname: { type: 'string', minLength: 1, maxLength: 100 },
        firstName: { type: 'string', minLength: 1, maxLength: 100 },
        otherNames: { type: 'string', maxLength: 200 },
      },
    },
    PersonKey: { type: 'string', pattern: '^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$' },
    Money: {
      type: 'object',
      required: ['kesCents'],
      additionalProperties: false,
      properties: {
        kesCents: {
          type: 'integer',
          minimum: 0,
          description: 'Approximate value in Kenyan shilling cents',
        },
        original: {
          type: 'object',
          description:
            'Original currency and amount for holdings outside Kenya (note 13); no conversion is performed',
          required: ['currency', 'minorUnits'],
          additionalProperties: false,
          properties: {
            currency: { type: 'string', pattern: '^[A-Z]{3}$' },
            minorUnits: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    Location: {
      type: 'object',
      required: ['inKenya'],
      additionalProperties: false,
      properties: {
        inKenya: { type: 'boolean' },
        county: {
          type: 'string',
          description: 'Kenyan county code 001-047 when inKenya',
          pattern: '^0(0[1-9]|[1-3][0-9]|4[0-7])$',
        },
        country: {
          type: 'string',
          description: 'ISO 3166-1 alpha-2 when outside Kenya',
          pattern: '^[A-Z]{2}$',
        },
        detail: { type: 'string', maxLength: 200 },
      },
    },
    ChangeFlag: {
      type: 'object',
      description: 'Act s.31(3)-(4): change since the previous declaration',
      required: ['changed'],
      additionalProperties: false,
      properties: {
        changed: { type: 'boolean' },
        kind: {
          type: 'string',
          enum: [
            'value-change',
            'acquisition',
            'disposal',
            'new-source',
            'source-ended',
            'settled',
          ],
        },
        explanation: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      if: { properties: { changed: { const: true } } },
      then: { required: ['changed', 'kind', 'explanation'] },
    },
    MaritalStatusChange: {
      type: 'object',
      required: ['changed'],
      additionalProperties: false,
      properties: {
        changed: { type: 'boolean' },
        explanation: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      if: { properties: { changed: { const: true } } },
      then: { required: ['changed', 'explanation'] },
    },
    Attachment: {
      type: 'object',
      required: ['attachmentId', 'uploadId', 'fileName', 'sha256'],
      additionalProperties: false,
      properties: {
        attachmentId: {
          type: 'string',
          format: 'uuid',
          description:
            "The link's id, set by the declarations service when it links the upload; unlinking takes it",
        },
        uploadId: { type: 'string', format: 'uuid' },
        fileName: { type: 'string', maxLength: 255 },
        sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
    },
    ItemSource: {
      type: 'object',
      description:
        'Where a pre-filled item came from (spec 05b); absent for manually entered items',
      required: ['kind', 'suggestionId', 'at'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['kra', 'ntsa', 'brs', 'ardhisasa', 'document'] },
        suggestionId: { type: 'string', format: 'uuid' },
        verificationResultId: { type: 'string', format: 'uuid' },
        aiJobId: { type: 'string', format: 'uuid' },
        at: { type: 'string', format: 'date-time' },
      },
    },
    Spouse: {
      type: 'object',
      required: ['id', 'name', 'separated'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { $ref: '#/$defs/PersonName' },
        nationalId: { type: 'string', pattern: '^[0-9]{5,10}$' },
        kraPin: { type: 'string', pattern: '^[AP][0-9]{9}[A-Z]$' },
        occupationSector: {
          type: 'string',
          enum: ['public', 'private', 'not-employed', 'unknown'],
        },
        separated: { type: 'boolean' },
        separationDate: { type: 'string', format: 'date' },
      },
    },
    Child: {
      type: 'object',
      required: ['id', 'name', 'dateOfBirth', 'includedAtStatementDate'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { $ref: '#/$defs/PersonName' },
        dateOfBirth: { type: 'string', format: 'date' },
        nationalId: { type: 'string', pattern: '^[0-9]{5,10}$' },
        includedAtStatementDate: {
          type: 'boolean',
          description: 'True when under 18 on the statement date; derived, not entered',
        },
      },
    },
    IncomeItem: {
      type: 'object',
      required: ['id', 'type', 'description', 'amount', 'location', 'change'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        type: {
          type: 'string',
          enum: [
            'salary-emoluments',
            'allowances',
            'business',
            'rent',
            'dividends-interest',
            'pension',
            'farming',
            'consultancy',
            'other',
          ],
        },
        description: { type: 'string', minLength: 1, maxLength: 200 },
        amount: { $ref: '#/$defs/Money' },
        location: { $ref: '#/$defs/Location' },
        change: { $ref: '#/$defs/ChangeFlag' },
        source: { $ref: '#/$defs/ItemSource' },
        attachments: { type: 'array', items: { $ref: '#/$defs/Attachment' } },
      },
    },
    AssetItem: {
      type: 'object',
      required: ['id', 'type', 'description', 'value', 'location', 'joint', 'change'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        type: {
          type: 'string',
          enum: [
            'land',
            'building',
            'vehicle',
            'securities',
            'shareholding',
            'bank-account',
            'cash',
            'receivable',
            'other',
          ],
        },
        description: { type: 'string', minLength: 1, maxLength: 200 },
        details: {
          type: 'object',
          description: 'Type-specific identifiers; no account numbers',
          additionalProperties: false,
          properties: {
            parcelNumber: { type: 'string', maxLength: 100 },
            size: { type: 'string', maxLength: 50 },
            registration: { type: 'string', maxLength: 20 },
            makeModel: { type: 'string', maxLength: 100 },
            issuer: { type: 'string', maxLength: 200 },
            quantityOrPercent: { type: 'string', maxLength: 50 },
            institution: { type: 'string', maxLength: 200 },
            accountType: { type: 'string', maxLength: 50 },
            debtor: { type: 'string', maxLength: 200 },
          },
        },
        value: { $ref: '#/$defs/Money' },
        location: { $ref: '#/$defs/Location' },
        joint: {
          type: 'object',
          required: ['isJoint'],
          additionalProperties: false,
          properties: {
            isJoint: { type: 'boolean' },
            sharePercent: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
            coOwner: { type: 'string', maxLength: 200 },
          },
          if: { properties: { isJoint: { const: true } } },
          then: { required: ['isJoint', 'sharePercent'] },
        },
        change: { $ref: '#/$defs/ChangeFlag' },
        source: { $ref: '#/$defs/ItemSource' },
        attachments: { type: 'array', items: { $ref: '#/$defs/Attachment' } },
      },
    },
    LiabilityItem: {
      type: 'object',
      required: ['id', 'type', 'description', 'creditor', 'outstanding', 'location', 'change'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid' },
        type: { type: 'string', enum: ['mortgage', 'loan', 'guarantee', 'other'] },
        description: { type: 'string', minLength: 1, maxLength: 200 },
        creditor: { type: 'string', minLength: 1, maxLength: 200 },
        outstanding: { $ref: '#/$defs/Money' },
        location: { $ref: '#/$defs/Location' },
        change: { $ref: '#/$defs/ChangeFlag' },
        source: { $ref: '#/$defs/ItemSource' },
        attachments: { type: 'array', items: { $ref: '#/$defs/Attachment' } },
      },
    },
    Statement: {
      type: 'object',
      description: 'Paragraph 8 for one person',
      required: [
        'personKey',
        'personName',
        'statementDate',
        'incomePeriod',
        'incomeNil',
        'income',
        'assetsNil',
        'assets',
        'liabilitiesNil',
        'liabilities',
      ],
      additionalProperties: false,
      properties: {
        personKey: { $ref: '#/$defs/PersonKey' },
        personName: { $ref: '#/$defs/PersonName' },
        statementDate: { type: 'string', format: 'date' },
        incomePeriod: {
          type: 'object',
          required: ['from', 'to'],
          additionalProperties: false,
          properties: {
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
          },
        },
        incomeNil: { type: 'boolean' },
        income: { type: 'array', items: { $ref: '#/$defs/IncomeItem' } },
        assetsNil: { type: 'boolean' },
        assets: { type: 'array', items: { $ref: '#/$defs/AssetItem' } },
        liabilitiesNil: { type: 'boolean' },
        liabilities: { type: 'array', items: { $ref: '#/$defs/LiabilityItem' } },
        knowledgeLimitation: {
          type: 'string',
          description: 'For a separated spouse: extent to which the officer knows their affairs',
          maxLength: 1000,
        },
      },
      allOf: [
        {
          if: { properties: { incomeNil: { const: true } } },
          then: { properties: { income: { maxItems: 0 } } },
          else: { properties: { income: { minItems: 1 } } },
        },
        {
          if: { properties: { assetsNil: { const: true } } },
          then: { properties: { assets: { maxItems: 0 } } },
          else: { properties: { assets: { minItems: 1 } } },
        },
        {
          if: { properties: { liabilitiesNil: { const: true } } },
          then: { properties: { liabilities: { maxItems: 0 } } },
          else: { properties: { liabilities: { minItems: 1 } } },
        },
      ],
    },
    MaterialChangeEntry: {
      type: 'object',
      required: ['kind', 'explanation'],
      additionalProperties: false,
      properties: {
        personKey: { $ref: '#/$defs/PersonKey' },
        itemId: { type: 'string', format: 'uuid' },
        itemDescription: { type: 'string', maxLength: 200 },
        kind: {
          type: 'string',
          enum: [
            'value-change',
            'acquisition',
            'disposal',
            'new-source',
            'source-ended',
            'settled',
            'marital-status',
            'directorship',
            'membership',
          ],
        },
        explanation: { type: 'string', maxLength: 1000 },
      },
    },
    RegistrableInterests: {
      type: 'object',
      description: 'Second Schedule vocabulary relevant to paragraph 9',
      required: ['directorships', 'memberships', 'dualCitizenship', 'pendingCases'],
      additionalProperties: false,
      properties: {
        directorships: {
          type: 'array',
          items: {
            type: 'object',
            required: ['company', 'role', 'remunerated'],
            additionalProperties: false,
            properties: {
              id: {
                type: 'string',
                format: 'uuid',
                description:
                  'Set when the directorship was added from a registry suggestion (spec 05b), which `source` names',
              },
              company: { type: 'string', maxLength: 200 },
              role: { type: 'string', maxLength: 100 },
              remunerated: { type: 'boolean' },
              change: { $ref: '#/$defs/ChangeFlag' },
              source: { $ref: '#/$defs/ItemSource' },
            },
          },
        },
        memberships: {
          type: 'array',
          items: {
            type: 'object',
            required: ['entity', 'kind'],
            additionalProperties: false,
            properties: {
              entity: { type: 'string', maxLength: 200 },
              kind: {
                type: 'string',
                enum: ['company', 'partnership', 'society', 'club', 'foundation', 'trust', 'other'],
              },
              change: { $ref: '#/$defs/ChangeFlag' },
            },
          },
        },
        dualCitizenship: {
          type: 'object',
          required: ['holds', 'pendingApplication'],
          additionalProperties: false,
          properties: {
            holds: { type: 'boolean' },
            country: { type: 'string', pattern: '^[A-Z]{2}$' },
            pendingApplication: { type: 'boolean' },
          },
        },
        pendingCases: {
          type: 'array',
          items: {
            type: 'object',
            required: ['forum', 'reference', 'nature'],
            additionalProperties: false,
            properties: {
              forum: { type: 'string', maxLength: 200 },
              reference: { type: 'string', maxLength: 100 },
              nature: { type: 'string', maxLength: 500 },
            },
          },
        },
      },
    },
  },
};
const schema32 = {
  type: 'object',
  required: ['surname', 'firstName'],
  additionalProperties: false,
  properties: {
    surname: { type: 'string', minLength: 1, maxLength: 100 },
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    otherNames: { type: 'string', maxLength: 200 },
  },
};
const schema33 = {
  type: 'object',
  required: ['changed'],
  additionalProperties: false,
  properties: {
    changed: { type: 'boolean' },
    explanation: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  if: { properties: { changed: { const: true } } },
  then: { required: ['changed', 'explanation'] },
};
const func1 = Object.prototype.hasOwnProperty;
const func2 = ucs2length;
const formats0 = fullFormats.date;
const formats32 = fullFormats['date-time'];
const pattern4 = new RegExp('^[a-z][a-z0-9]{1,19}$', 'u');
const schema34 = {
  type: 'object',
  required: ['id', 'name', 'separated'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { $ref: '#/$defs/PersonName' },
    nationalId: { type: 'string', pattern: '^[0-9]{5,10}$' },
    kraPin: { type: 'string', pattern: '^[AP][0-9]{9}[A-Z]$' },
    occupationSector: { type: 'string', enum: ['public', 'private', 'not-employed', 'unknown'] },
    separated: { type: 'boolean' },
    separationDate: { type: 'string', format: 'date' },
  },
};
const formats10 = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const pattern5 = new RegExp('^[0-9]{5,10}$', 'u');
const pattern6 = new RegExp('^[AP][0-9]{9}[A-Z]$', 'u');
function validate21(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate21.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.id === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'id' },
        message: "must have required property '" + 'id' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.name === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'name' },
        message: "must have required property '" + 'name' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.separated === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'separated' },
        message: "must have required property '" + 'separated' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(
        key0 === 'id' ||
        key0 === 'name' ||
        key0 === 'nationalId' ||
        key0 === 'kraPin' ||
        key0 === 'occupationSector' ||
        key0 === 'separated' ||
        key0 === 'separationDate'
      )) {
        const err3 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.id !== undefined) {
      let data0 = data.id;
      if (typeof data0 === 'string') {
        if (!formats10.test(data0)) {
          const err4 = {
            instancePath: instancePath + '/id',
            schemaPath: '#/properties/id/format',
            keyword: 'format',
            params: { format: 'uuid' },
            message: 'must match format "' + 'uuid' + '"',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = {
          instancePath: instancePath + '/id',
          schemaPath: '#/properties/id/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.name !== undefined) {
      let data1 = data.name;
      if (data1 && typeof data1 == 'object' && !Array.isArray(data1)) {
        if (data1.surname === undefined) {
          const err6 = {
            instancePath: instancePath + '/name',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'surname' },
            message: "must have required property '" + 'surname' + "'",
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data1.firstName === undefined) {
          const err7 = {
            instancePath: instancePath + '/name',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'firstName' },
            message: "must have required property '" + 'firstName' + "'",
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        for (const key1 in data1) {
          if (!(key1 === 'surname' || key1 === 'firstName' || key1 === 'otherNames')) {
            const err8 = {
              instancePath: instancePath + '/name',
              schemaPath: '#/$defs/PersonName/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
        if (data1.surname !== undefined) {
          let data2 = data1.surname;
          if (typeof data2 === 'string') {
            if (func2(data2) > 100) {
              const err9 = {
                instancePath: instancePath + '/name/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err9];
              } else {
                vErrors.push(err9);
              }
              errors++;
            }
            if (func2(data2) < 1) {
              const err10 = {
                instancePath: instancePath + '/name/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
          } else {
            const err11 = {
              instancePath: instancePath + '/name/surname',
              schemaPath: '#/$defs/PersonName/properties/surname/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        }
        if (data1.firstName !== undefined) {
          let data3 = data1.firstName;
          if (typeof data3 === 'string') {
            if (func2(data3) > 100) {
              const err12 = {
                instancePath: instancePath + '/name/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err12];
              } else {
                vErrors.push(err12);
              }
              errors++;
            }
            if (func2(data3) < 1) {
              const err13 = {
                instancePath: instancePath + '/name/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
          } else {
            const err14 = {
              instancePath: instancePath + '/name/firstName',
              schemaPath: '#/$defs/PersonName/properties/firstName/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
        }
        if (data1.otherNames !== undefined) {
          let data4 = data1.otherNames;
          if (typeof data4 === 'string') {
            if (func2(data4) > 200) {
              const err15 = {
                instancePath: instancePath + '/name/otherNames',
                schemaPath: '#/$defs/PersonName/properties/otherNames/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
          } else {
            const err16 = {
              instancePath: instancePath + '/name/otherNames',
              schemaPath: '#/$defs/PersonName/properties/otherNames/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        }
      } else {
        const err17 = {
          instancePath: instancePath + '/name',
          schemaPath: '#/$defs/PersonName/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.nationalId !== undefined) {
      let data5 = data.nationalId;
      if (typeof data5 === 'string') {
        if (!pattern5.test(data5)) {
          const err18 = {
            instancePath: instancePath + '/nationalId',
            schemaPath: '#/properties/nationalId/pattern',
            keyword: 'pattern',
            params: { pattern: '^[0-9]{5,10}$' },
            message: 'must match pattern "' + '^[0-9]{5,10}$' + '"',
          };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = {
          instancePath: instancePath + '/nationalId',
          schemaPath: '#/properties/nationalId/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.kraPin !== undefined) {
      let data6 = data.kraPin;
      if (typeof data6 === 'string') {
        if (!pattern6.test(data6)) {
          const err20 = {
            instancePath: instancePath + '/kraPin',
            schemaPath: '#/properties/kraPin/pattern',
            keyword: 'pattern',
            params: { pattern: '^[AP][0-9]{9}[A-Z]$' },
            message: 'must match pattern "' + '^[AP][0-9]{9}[A-Z]$' + '"',
          };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      } else {
        const err21 = {
          instancePath: instancePath + '/kraPin',
          schemaPath: '#/properties/kraPin/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.occupationSector !== undefined) {
      let data7 = data.occupationSector;
      if (typeof data7 !== 'string') {
        const err22 = {
          instancePath: instancePath + '/occupationSector',
          schemaPath: '#/properties/occupationSector/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
      if (!(
        data7 === 'public' ||
        data7 === 'private' ||
        data7 === 'not-employed' ||
        data7 === 'unknown'
      )) {
        const err23 = {
          instancePath: instancePath + '/occupationSector',
          schemaPath: '#/properties/occupationSector/enum',
          keyword: 'enum',
          params: { allowedValues: schema34.properties.occupationSector.enum },
          message: 'must be equal to one of the allowed values',
        };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.separated !== undefined) {
      if (typeof data.separated !== 'boolean') {
        const err24 = {
          instancePath: instancePath + '/separated',
          schemaPath: '#/properties/separated/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.separationDate !== undefined) {
      let data9 = data.separationDate;
      if (typeof data9 === 'string') {
        if (!formats0.validate(data9)) {
          const err25 = {
            instancePath: instancePath + '/separationDate',
            schemaPath: '#/properties/separationDate/format',
            keyword: 'format',
            params: { format: 'date' },
            message: 'must match format "' + 'date' + '"',
          };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
      } else {
        const err26 = {
          instancePath: instancePath + '/separationDate',
          schemaPath: '#/properties/separationDate/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
  } else {
    const err27 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err27];
    } else {
      vErrors.push(err27);
    }
    errors++;
  }
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema36 = {
  type: 'object',
  required: ['id', 'name', 'dateOfBirth', 'includedAtStatementDate'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { $ref: '#/$defs/PersonName' },
    dateOfBirth: { type: 'string', format: 'date' },
    nationalId: { type: 'string', pattern: '^[0-9]{5,10}$' },
    includedAtStatementDate: {
      type: 'boolean',
      description: 'True when under 18 on the statement date; derived, not entered',
    },
  },
};
function validate23(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate23.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.id === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'id' },
        message: "must have required property '" + 'id' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.name === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'name' },
        message: "must have required property '" + 'name' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.dateOfBirth === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'dateOfBirth' },
        message: "must have required property '" + 'dateOfBirth' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.includedAtStatementDate === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'includedAtStatementDate' },
        message: "must have required property '" + 'includedAtStatementDate' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(
        key0 === 'id' ||
        key0 === 'name' ||
        key0 === 'dateOfBirth' ||
        key0 === 'nationalId' ||
        key0 === 'includedAtStatementDate'
      )) {
        const err4 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.id !== undefined) {
      let data0 = data.id;
      if (typeof data0 === 'string') {
        if (!formats10.test(data0)) {
          const err5 = {
            instancePath: instancePath + '/id',
            schemaPath: '#/properties/id/format',
            keyword: 'format',
            params: { format: 'uuid' },
            message: 'must match format "' + 'uuid' + '"',
          };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = {
          instancePath: instancePath + '/id',
          schemaPath: '#/properties/id/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.name !== undefined) {
      let data1 = data.name;
      if (data1 && typeof data1 == 'object' && !Array.isArray(data1)) {
        if (data1.surname === undefined) {
          const err7 = {
            instancePath: instancePath + '/name',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'surname' },
            message: "must have required property '" + 'surname' + "'",
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        if (data1.firstName === undefined) {
          const err8 = {
            instancePath: instancePath + '/name',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'firstName' },
            message: "must have required property '" + 'firstName' + "'",
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
        for (const key1 in data1) {
          if (!(key1 === 'surname' || key1 === 'firstName' || key1 === 'otherNames')) {
            const err9 = {
              instancePath: instancePath + '/name',
              schemaPath: '#/$defs/PersonName/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data1.surname !== undefined) {
          let data2 = data1.surname;
          if (typeof data2 === 'string') {
            if (func2(data2) > 100) {
              const err10 = {
                instancePath: instancePath + '/name/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
            if (func2(data2) < 1) {
              const err11 = {
                instancePath: instancePath + '/name/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
          } else {
            const err12 = {
              instancePath: instancePath + '/name/surname',
              schemaPath: '#/$defs/PersonName/properties/surname/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
        if (data1.firstName !== undefined) {
          let data3 = data1.firstName;
          if (typeof data3 === 'string') {
            if (func2(data3) > 100) {
              const err13 = {
                instancePath: instancePath + '/name/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
            if (func2(data3) < 1) {
              const err14 = {
                instancePath: instancePath + '/name/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
            }
          } else {
            const err15 = {
              instancePath: instancePath + '/name/firstName',
              schemaPath: '#/$defs/PersonName/properties/firstName/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err15];
            } else {
              vErrors.push(err15);
            }
            errors++;
          }
        }
        if (data1.otherNames !== undefined) {
          let data4 = data1.otherNames;
          if (typeof data4 === 'string') {
            if (func2(data4) > 200) {
              const err16 = {
                instancePath: instancePath + '/name/otherNames',
                schemaPath: '#/$defs/PersonName/properties/otherNames/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err16];
              } else {
                vErrors.push(err16);
              }
              errors++;
            }
          } else {
            const err17 = {
              instancePath: instancePath + '/name/otherNames',
              schemaPath: '#/$defs/PersonName/properties/otherNames/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
        }
      } else {
        const err18 = {
          instancePath: instancePath + '/name',
          schemaPath: '#/$defs/PersonName/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.dateOfBirth !== undefined) {
      let data5 = data.dateOfBirth;
      if (typeof data5 === 'string') {
        if (!formats0.validate(data5)) {
          const err19 = {
            instancePath: instancePath + '/dateOfBirth',
            schemaPath: '#/properties/dateOfBirth/format',
            keyword: 'format',
            params: { format: 'date' },
            message: 'must match format "' + 'date' + '"',
          };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      } else {
        const err20 = {
          instancePath: instancePath + '/dateOfBirth',
          schemaPath: '#/properties/dateOfBirth/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
    if (data.nationalId !== undefined) {
      let data6 = data.nationalId;
      if (typeof data6 === 'string') {
        if (!pattern5.test(data6)) {
          const err21 = {
            instancePath: instancePath + '/nationalId',
            schemaPath: '#/properties/nationalId/pattern',
            keyword: 'pattern',
            params: { pattern: '^[0-9]{5,10}$' },
            message: 'must match pattern "' + '^[0-9]{5,10}$' + '"',
          };
          if (vErrors === null) {
            vErrors = [err21];
          } else {
            vErrors.push(err21);
          }
          errors++;
        }
      } else {
        const err22 = {
          instancePath: instancePath + '/nationalId',
          schemaPath: '#/properties/nationalId/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.includedAtStatementDate !== undefined) {
      if (typeof data.includedAtStatementDate !== 'boolean') {
        const err23 = {
          instancePath: instancePath + '/includedAtStatementDate',
          schemaPath: '#/properties/includedAtStatementDate/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
  } else {
    const err24 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err24];
    } else {
      vErrors.push(err24);
    }
    errors++;
  }
  validate23.errors = vErrors;
  return errors === 0;
}
validate23.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema38 = {
  type: 'object',
  description: 'Paragraph 8 for one person',
  required: [
    'personKey',
    'personName',
    'statementDate',
    'incomePeriod',
    'incomeNil',
    'income',
    'assetsNil',
    'assets',
    'liabilitiesNil',
    'liabilities',
  ],
  additionalProperties: false,
  properties: {
    personKey: { $ref: '#/$defs/PersonKey' },
    personName: { $ref: '#/$defs/PersonName' },
    statementDate: { type: 'string', format: 'date' },
    incomePeriod: {
      type: 'object',
      required: ['from', 'to'],
      additionalProperties: false,
      properties: {
        from: { type: 'string', format: 'date' },
        to: { type: 'string', format: 'date' },
      },
    },
    incomeNil: { type: 'boolean' },
    income: { type: 'array', items: { $ref: '#/$defs/IncomeItem' } },
    assetsNil: { type: 'boolean' },
    assets: { type: 'array', items: { $ref: '#/$defs/AssetItem' } },
    liabilitiesNil: { type: 'boolean' },
    liabilities: { type: 'array', items: { $ref: '#/$defs/LiabilityItem' } },
    knowledgeLimitation: {
      type: 'string',
      description: 'For a separated spouse: extent to which the officer knows their affairs',
      maxLength: 1000,
    },
  },
  allOf: [
    {
      if: { properties: { incomeNil: { const: true } } },
      then: { properties: { income: { maxItems: 0 } } },
      else: { properties: { income: { minItems: 1 } } },
    },
    {
      if: { properties: { assetsNil: { const: true } } },
      then: { properties: { assets: { maxItems: 0 } } },
      else: { properties: { assets: { minItems: 1 } } },
    },
    {
      if: { properties: { liabilitiesNil: { const: true } } },
      then: { properties: { liabilities: { maxItems: 0 } } },
      else: { properties: { liabilities: { minItems: 1 } } },
    },
  ],
};
const schema39 = {
  type: 'string',
  pattern: '^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$',
};
const pattern8 = new RegExp('^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$', 'u');
const schema41 = {
  type: 'object',
  required: ['id', 'type', 'description', 'amount', 'location', 'change'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    type: {
      type: 'string',
      enum: [
        'salary-emoluments',
        'allowances',
        'business',
        'rent',
        'dividends-interest',
        'pension',
        'farming',
        'consultancy',
        'other',
      ],
    },
    description: { type: 'string', minLength: 1, maxLength: 200 },
    amount: { $ref: '#/$defs/Money' },
    location: { $ref: '#/$defs/Location' },
    change: { $ref: '#/$defs/ChangeFlag' },
    source: { $ref: '#/$defs/ItemSource' },
    attachments: { type: 'array', items: { $ref: '#/$defs/Attachment' } },
  },
};
const schema42 = {
  type: 'object',
  required: ['kesCents'],
  additionalProperties: false,
  properties: {
    kesCents: {
      type: 'integer',
      minimum: 0,
      description: 'Approximate value in Kenyan shilling cents',
    },
    original: {
      type: 'object',
      description:
        'Original currency and amount for holdings outside Kenya (note 13); no conversion is performed',
      required: ['currency', 'minorUnits'],
      additionalProperties: false,
      properties: {
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        minorUnits: { type: 'integer', minimum: 0 },
      },
    },
  },
};
const schema43 = {
  type: 'object',
  required: ['inKenya'],
  additionalProperties: false,
  properties: {
    inKenya: { type: 'boolean' },
    county: {
      type: 'string',
      description: 'Kenyan county code 001-047 when inKenya',
      pattern: '^0(0[1-9]|[1-3][0-9]|4[0-7])$',
    },
    country: {
      type: 'string',
      description: 'ISO 3166-1 alpha-2 when outside Kenya',
      pattern: '^[A-Z]{2}$',
    },
    detail: { type: 'string', maxLength: 200 },
  },
};
const schema44 = {
  type: 'object',
  description: 'Act s.31(3)-(4): change since the previous declaration',
  required: ['changed'],
  additionalProperties: false,
  properties: {
    changed: { type: 'boolean' },
    kind: {
      type: 'string',
      enum: ['value-change', 'acquisition', 'disposal', 'new-source', 'source-ended', 'settled'],
    },
    explanation: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  if: { properties: { changed: { const: true } } },
  then: { required: ['changed', 'kind', 'explanation'] },
};
const schema45 = {
  type: 'object',
  description: 'Where a pre-filled item came from (spec 05b); absent for manually entered items',
  required: ['kind', 'suggestionId', 'at'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['kra', 'ntsa', 'brs', 'ardhisasa', 'document'] },
    suggestionId: { type: 'string', format: 'uuid' },
    verificationResultId: { type: 'string', format: 'uuid' },
    aiJobId: { type: 'string', format: 'uuid' },
    at: { type: 'string', format: 'date-time' },
  },
};
const schema46 = {
  type: 'object',
  required: ['attachmentId', 'uploadId', 'fileName', 'sha256'],
  additionalProperties: false,
  properties: {
    attachmentId: {
      type: 'string',
      format: 'uuid',
      description:
        "The link's id, set by the declarations service when it links the upload; unlinking takes it",
    },
    uploadId: { type: 'string', format: 'uuid' },
    fileName: { type: 'string', maxLength: 255 },
    sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
};
const pattern9 = new RegExp('^[A-Z]{3}$', 'u');
const pattern10 = new RegExp('^0(0[1-9]|[1-3][0-9]|4[0-7])$', 'u');
const pattern11 = new RegExp('^[A-Z]{2}$', 'u');
const pattern12 = new RegExp('^[0-9a-f]{64}$', 'u');
function validate26(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate26.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.id === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'id' },
        message: "must have required property '" + 'id' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'type' },
        message: "must have required property '" + 'type' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.description === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'description' },
        message: "must have required property '" + 'description' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.amount === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'amount' },
        message: "must have required property '" + 'amount' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.location === undefined) {
      const err4 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'location' },
        message: "must have required property '" + 'location' + "'",
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.change === undefined) {
      const err5 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'change' },
        message: "must have required property '" + 'change' + "'",
      };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(
        key0 === 'id' ||
        key0 === 'type' ||
        key0 === 'description' ||
        key0 === 'amount' ||
        key0 === 'location' ||
        key0 === 'change' ||
        key0 === 'source' ||
        key0 === 'attachments'
      )) {
        const err6 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== undefined) {
      let data0 = data.id;
      if (typeof data0 === 'string') {
        if (!formats10.test(data0)) {
          const err7 = {
            instancePath: instancePath + '/id',
            schemaPath: '#/properties/id/format',
            keyword: 'format',
            params: { format: 'uuid' },
            message: 'must match format "' + 'uuid' + '"',
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = {
          instancePath: instancePath + '/id',
          schemaPath: '#/properties/id/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.type !== undefined) {
      let data1 = data.type;
      if (typeof data1 !== 'string') {
        const err9 = {
          instancePath: instancePath + '/type',
          schemaPath: '#/properties/type/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
      if (!(
        data1 === 'salary-emoluments' ||
        data1 === 'allowances' ||
        data1 === 'business' ||
        data1 === 'rent' ||
        data1 === 'dividends-interest' ||
        data1 === 'pension' ||
        data1 === 'farming' ||
        data1 === 'consultancy' ||
        data1 === 'other'
      )) {
        const err10 = {
          instancePath: instancePath + '/type',
          schemaPath: '#/properties/type/enum',
          keyword: 'enum',
          params: { allowedValues: schema41.properties.type.enum },
          message: 'must be equal to one of the allowed values',
        };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.description !== undefined) {
      let data2 = data.description;
      if (typeof data2 === 'string') {
        if (func2(data2) > 200) {
          const err11 = {
            instancePath: instancePath + '/description',
            schemaPath: '#/properties/description/maxLength',
            keyword: 'maxLength',
            params: { limit: 200 },
            message: 'must NOT have more than 200 characters',
          };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
        if (func2(data2) < 1) {
          const err12 = {
            instancePath: instancePath + '/description',
            schemaPath: '#/properties/description/minLength',
            keyword: 'minLength',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 characters',
          };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = {
          instancePath: instancePath + '/description',
          schemaPath: '#/properties/description/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.amount !== undefined) {
      let data3 = data.amount;
      if (data3 && typeof data3 == 'object' && !Array.isArray(data3)) {
        if (data3.kesCents === undefined) {
          const err14 = {
            instancePath: instancePath + '/amount',
            schemaPath: '#/$defs/Money/required',
            keyword: 'required',
            params: { missingProperty: 'kesCents' },
            message: "must have required property '" + 'kesCents' + "'",
          };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        for (const key1 in data3) {
          if (!(key1 === 'kesCents' || key1 === 'original')) {
            const err15 = {
              instancePath: instancePath + '/amount',
              schemaPath: '#/$defs/Money/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err15];
            } else {
              vErrors.push(err15);
            }
            errors++;
          }
        }
        if (data3.kesCents !== undefined) {
          let data4 = data3.kesCents;
          if (!(typeof data4 == 'number' && !(data4 % 1) && !isNaN(data4) && isFinite(data4))) {
            const err16 = {
              instancePath: instancePath + '/amount/kesCents',
              schemaPath: '#/$defs/Money/properties/kesCents/type',
              keyword: 'type',
              params: { type: 'integer' },
              message: 'must be integer',
            };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
          if (typeof data4 == 'number' && isFinite(data4)) {
            if (data4 < 0 || isNaN(data4)) {
              const err17 = {
                instancePath: instancePath + '/amount/kesCents',
                schemaPath: '#/$defs/Money/properties/kesCents/minimum',
                keyword: 'minimum',
                params: { comparison: '>=', limit: 0 },
                message: 'must be >= 0',
              };
              if (vErrors === null) {
                vErrors = [err17];
              } else {
                vErrors.push(err17);
              }
              errors++;
            }
          }
        }
        if (data3.original !== undefined) {
          let data5 = data3.original;
          if (data5 && typeof data5 == 'object' && !Array.isArray(data5)) {
            if (data5.currency === undefined) {
              const err18 = {
                instancePath: instancePath + '/amount/original',
                schemaPath: '#/$defs/Money/properties/original/required',
                keyword: 'required',
                params: { missingProperty: 'currency' },
                message: "must have required property '" + 'currency' + "'",
              };
              if (vErrors === null) {
                vErrors = [err18];
              } else {
                vErrors.push(err18);
              }
              errors++;
            }
            if (data5.minorUnits === undefined) {
              const err19 = {
                instancePath: instancePath + '/amount/original',
                schemaPath: '#/$defs/Money/properties/original/required',
                keyword: 'required',
                params: { missingProperty: 'minorUnits' },
                message: "must have required property '" + 'minorUnits' + "'",
              };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
            for (const key2 in data5) {
              if (!(key2 === 'currency' || key2 === 'minorUnits')) {
                const err20 = {
                  instancePath: instancePath + '/amount/original',
                  schemaPath: '#/$defs/Money/properties/original/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key2 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err20];
                } else {
                  vErrors.push(err20);
                }
                errors++;
              }
            }
            if (data5.currency !== undefined) {
              let data6 = data5.currency;
              if (typeof data6 === 'string') {
                if (!pattern9.test(data6)) {
                  const err21 = {
                    instancePath: instancePath + '/amount/original/currency',
                    schemaPath: '#/$defs/Money/properties/original/properties/currency/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^[A-Z]{3}$' },
                    message: 'must match pattern "' + '^[A-Z]{3}$' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err21];
                  } else {
                    vErrors.push(err21);
                  }
                  errors++;
                }
              } else {
                const err22 = {
                  instancePath: instancePath + '/amount/original/currency',
                  schemaPath: '#/$defs/Money/properties/original/properties/currency/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err22];
                } else {
                  vErrors.push(err22);
                }
                errors++;
              }
            }
            if (data5.minorUnits !== undefined) {
              let data7 = data5.minorUnits;
              if (!(typeof data7 == 'number' && !(data7 % 1) && !isNaN(data7) && isFinite(data7))) {
                const err23 = {
                  instancePath: instancePath + '/amount/original/minorUnits',
                  schemaPath: '#/$defs/Money/properties/original/properties/minorUnits/type',
                  keyword: 'type',
                  params: { type: 'integer' },
                  message: 'must be integer',
                };
                if (vErrors === null) {
                  vErrors = [err23];
                } else {
                  vErrors.push(err23);
                }
                errors++;
              }
              if (typeof data7 == 'number' && isFinite(data7)) {
                if (data7 < 0 || isNaN(data7)) {
                  const err24 = {
                    instancePath: instancePath + '/amount/original/minorUnits',
                    schemaPath: '#/$defs/Money/properties/original/properties/minorUnits/minimum',
                    keyword: 'minimum',
                    params: { comparison: '>=', limit: 0 },
                    message: 'must be >= 0',
                  };
                  if (vErrors === null) {
                    vErrors = [err24];
                  } else {
                    vErrors.push(err24);
                  }
                  errors++;
                }
              }
            }
          } else {
            const err25 = {
              instancePath: instancePath + '/amount/original',
              schemaPath: '#/$defs/Money/properties/original/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err25];
            } else {
              vErrors.push(err25);
            }
            errors++;
          }
        }
      } else {
        const err26 = {
          instancePath: instancePath + '/amount',
          schemaPath: '#/$defs/Money/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.location !== undefined) {
      let data8 = data.location;
      if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
        if (data8.inKenya === undefined) {
          const err27 = {
            instancePath: instancePath + '/location',
            schemaPath: '#/$defs/Location/required',
            keyword: 'required',
            params: { missingProperty: 'inKenya' },
            message: "must have required property '" + 'inKenya' + "'",
          };
          if (vErrors === null) {
            vErrors = [err27];
          } else {
            vErrors.push(err27);
          }
          errors++;
        }
        for (const key3 in data8) {
          if (!(
            key3 === 'inKenya' ||
            key3 === 'county' ||
            key3 === 'country' ||
            key3 === 'detail'
          )) {
            const err28 = {
              instancePath: instancePath + '/location',
              schemaPath: '#/$defs/Location/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key3 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err28];
            } else {
              vErrors.push(err28);
            }
            errors++;
          }
        }
        if (data8.inKenya !== undefined) {
          if (typeof data8.inKenya !== 'boolean') {
            const err29 = {
              instancePath: instancePath + '/location/inKenya',
              schemaPath: '#/$defs/Location/properties/inKenya/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err29];
            } else {
              vErrors.push(err29);
            }
            errors++;
          }
        }
        if (data8.county !== undefined) {
          let data10 = data8.county;
          if (typeof data10 === 'string') {
            if (!pattern10.test(data10)) {
              const err30 = {
                instancePath: instancePath + '/location/county',
                schemaPath: '#/$defs/Location/properties/county/pattern',
                keyword: 'pattern',
                params: { pattern: '^0(0[1-9]|[1-3][0-9]|4[0-7])$' },
                message: 'must match pattern "' + '^0(0[1-9]|[1-3][0-9]|4[0-7])$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err30];
              } else {
                vErrors.push(err30);
              }
              errors++;
            }
          } else {
            const err31 = {
              instancePath: instancePath + '/location/county',
              schemaPath: '#/$defs/Location/properties/county/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err31];
            } else {
              vErrors.push(err31);
            }
            errors++;
          }
        }
        if (data8.country !== undefined) {
          let data11 = data8.country;
          if (typeof data11 === 'string') {
            if (!pattern11.test(data11)) {
              const err32 = {
                instancePath: instancePath + '/location/country',
                schemaPath: '#/$defs/Location/properties/country/pattern',
                keyword: 'pattern',
                params: { pattern: '^[A-Z]{2}$' },
                message: 'must match pattern "' + '^[A-Z]{2}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err32];
              } else {
                vErrors.push(err32);
              }
              errors++;
            }
          } else {
            const err33 = {
              instancePath: instancePath + '/location/country',
              schemaPath: '#/$defs/Location/properties/country/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err33];
            } else {
              vErrors.push(err33);
            }
            errors++;
          }
        }
        if (data8.detail !== undefined) {
          let data12 = data8.detail;
          if (typeof data12 === 'string') {
            if (func2(data12) > 200) {
              const err34 = {
                instancePath: instancePath + '/location/detail',
                schemaPath: '#/$defs/Location/properties/detail/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err34];
              } else {
                vErrors.push(err34);
              }
              errors++;
            }
          } else {
            const err35 = {
              instancePath: instancePath + '/location/detail',
              schemaPath: '#/$defs/Location/properties/detail/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
      } else {
        const err36 = {
          instancePath: instancePath + '/location',
          schemaPath: '#/$defs/Location/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
    }
    if (data.change !== undefined) {
      let data13 = data.change;
      const _errs36 = errors;
      let valid7 = true;
      const _errs37 = errors;
      if (data13 && typeof data13 == 'object' && !Array.isArray(data13)) {
        if (data13.changed !== undefined) {
          if (true !== data13.changed) {
            const err37 = {};
            if (vErrors === null) {
              vErrors = [err37];
            } else {
              vErrors.push(err37);
            }
            errors++;
          }
        }
      }
      var _valid0 = _errs37 === errors;
      errors = _errs36;
      if (vErrors !== null) {
        if (_errs36) {
          vErrors.length = _errs36;
        } else {
          vErrors = null;
        }
      }
      if (_valid0) {
        const _errs39 = errors;
        if (data13 && typeof data13 == 'object' && !Array.isArray(data13)) {
          if (data13.changed === undefined) {
            const err38 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/then/required',
              keyword: 'required',
              params: { missingProperty: 'changed' },
              message: "must have required property '" + 'changed' + "'",
            };
            if (vErrors === null) {
              vErrors = [err38];
            } else {
              vErrors.push(err38);
            }
            errors++;
          }
          if (data13.kind === undefined) {
            const err39 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/then/required',
              keyword: 'required',
              params: { missingProperty: 'kind' },
              message: "must have required property '" + 'kind' + "'",
            };
            if (vErrors === null) {
              vErrors = [err39];
            } else {
              vErrors.push(err39);
            }
            errors++;
          }
          if (data13.explanation === undefined) {
            const err40 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/then/required',
              keyword: 'required',
              params: { missingProperty: 'explanation' },
              message: "must have required property '" + 'explanation' + "'",
            };
            if (vErrors === null) {
              vErrors = [err40];
            } else {
              vErrors.push(err40);
            }
            errors++;
          }
        }
        var _valid0 = _errs39 === errors;
        valid7 = _valid0;
      }
      if (!valid7) {
        const err41 = {
          instancePath: instancePath + '/change',
          schemaPath: '#/$defs/ChangeFlag/if',
          keyword: 'if',
          params: { failingKeyword: 'then' },
          message: 'must match "then" schema',
        };
        if (vErrors === null) {
          vErrors = [err41];
        } else {
          vErrors.push(err41);
        }
        errors++;
      }
      if (data13 && typeof data13 == 'object' && !Array.isArray(data13)) {
        if (data13.changed === undefined) {
          const err42 = {
            instancePath: instancePath + '/change',
            schemaPath: '#/$defs/ChangeFlag/required',
            keyword: 'required',
            params: { missingProperty: 'changed' },
            message: "must have required property '" + 'changed' + "'",
          };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
        for (const key4 in data13) {
          if (!(key4 === 'changed' || key4 === 'kind' || key4 === 'explanation')) {
            const err43 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key4 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err43];
            } else {
              vErrors.push(err43);
            }
            errors++;
          }
        }
        if (data13.changed !== undefined) {
          if (typeof data13.changed !== 'boolean') {
            const err44 = {
              instancePath: instancePath + '/change/changed',
              schemaPath: '#/$defs/ChangeFlag/properties/changed/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err44];
            } else {
              vErrors.push(err44);
            }
            errors++;
          }
        }
        if (data13.kind !== undefined) {
          let data16 = data13.kind;
          if (typeof data16 !== 'string') {
            const err45 = {
              instancePath: instancePath + '/change/kind',
              schemaPath: '#/$defs/ChangeFlag/properties/kind/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
          if (!(
            data16 === 'value-change' ||
            data16 === 'acquisition' ||
            data16 === 'disposal' ||
            data16 === 'new-source' ||
            data16 === 'source-ended' ||
            data16 === 'settled'
          )) {
            const err46 = {
              instancePath: instancePath + '/change/kind',
              schemaPath: '#/$defs/ChangeFlag/properties/kind/enum',
              keyword: 'enum',
              params: { allowedValues: schema44.properties.kind.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err46];
            } else {
              vErrors.push(err46);
            }
            errors++;
          }
        }
        if (data13.explanation !== undefined) {
          let data17 = data13.explanation;
          if (typeof data17 === 'string') {
            if (func2(data17) > 1000) {
              const err47 = {
                instancePath: instancePath + '/change/explanation',
                schemaPath: '#/$defs/ChangeFlag/properties/explanation/maxLength',
                keyword: 'maxLength',
                params: { limit: 1000 },
                message: 'must NOT have more than 1000 characters',
              };
              if (vErrors === null) {
                vErrors = [err47];
              } else {
                vErrors.push(err47);
              }
              errors++;
            }
            if (func2(data17) < 1) {
              const err48 = {
                instancePath: instancePath + '/change/explanation',
                schemaPath: '#/$defs/ChangeFlag/properties/explanation/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err48];
              } else {
                vErrors.push(err48);
              }
              errors++;
            }
          } else {
            const err49 = {
              instancePath: instancePath + '/change/explanation',
              schemaPath: '#/$defs/ChangeFlag/properties/explanation/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err49];
            } else {
              vErrors.push(err49);
            }
            errors++;
          }
        }
      } else {
        const err50 = {
          instancePath: instancePath + '/change',
          schemaPath: '#/$defs/ChangeFlag/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err50];
        } else {
          vErrors.push(err50);
        }
        errors++;
      }
    }
    if (data.source !== undefined) {
      let data18 = data.source;
      if (data18 && typeof data18 == 'object' && !Array.isArray(data18)) {
        if (data18.kind === undefined) {
          const err51 = {
            instancePath: instancePath + '/source',
            schemaPath: '#/$defs/ItemSource/required',
            keyword: 'required',
            params: { missingProperty: 'kind' },
            message: "must have required property '" + 'kind' + "'",
          };
          if (vErrors === null) {
            vErrors = [err51];
          } else {
            vErrors.push(err51);
          }
          errors++;
        }
        if (data18.suggestionId === undefined) {
          const err52 = {
            instancePath: instancePath + '/source',
            schemaPath: '#/$defs/ItemSource/required',
            keyword: 'required',
            params: { missingProperty: 'suggestionId' },
            message: "must have required property '" + 'suggestionId' + "'",
          };
          if (vErrors === null) {
            vErrors = [err52];
          } else {
            vErrors.push(err52);
          }
          errors++;
        }
        if (data18.at === undefined) {
          const err53 = {
            instancePath: instancePath + '/source',
            schemaPath: '#/$defs/ItemSource/required',
            keyword: 'required',
            params: { missingProperty: 'at' },
            message: "must have required property '" + 'at' + "'",
          };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
        for (const key5 in data18) {
          if (!(
            key5 === 'kind' ||
            key5 === 'suggestionId' ||
            key5 === 'verificationResultId' ||
            key5 === 'aiJobId' ||
            key5 === 'at'
          )) {
            const err54 = {
              instancePath: instancePath + '/source',
              schemaPath: '#/$defs/ItemSource/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key5 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err54];
            } else {
              vErrors.push(err54);
            }
            errors++;
          }
        }
        if (data18.kind !== undefined) {
          let data19 = data18.kind;
          if (typeof data19 !== 'string') {
            const err55 = {
              instancePath: instancePath + '/source/kind',
              schemaPath: '#/$defs/ItemSource/properties/kind/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err55];
            } else {
              vErrors.push(err55);
            }
            errors++;
          }
          if (!(
            data19 === 'kra' ||
            data19 === 'ntsa' ||
            data19 === 'brs' ||
            data19 === 'ardhisasa' ||
            data19 === 'document'
          )) {
            const err56 = {
              instancePath: instancePath + '/source/kind',
              schemaPath: '#/$defs/ItemSource/properties/kind/enum',
              keyword: 'enum',
              params: { allowedValues: schema45.properties.kind.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err56];
            } else {
              vErrors.push(err56);
            }
            errors++;
          }
        }
        if (data18.suggestionId !== undefined) {
          let data20 = data18.suggestionId;
          if (typeof data20 === 'string') {
            if (!formats10.test(data20)) {
              const err57 = {
                instancePath: instancePath + '/source/suggestionId',
                schemaPath: '#/$defs/ItemSource/properties/suggestionId/format',
                keyword: 'format',
                params: { format: 'uuid' },
                message: 'must match format "' + 'uuid' + '"',
              };
              if (vErrors === null) {
                vErrors = [err57];
              } else {
                vErrors.push(err57);
              }
              errors++;
            }
          } else {
            const err58 = {
              instancePath: instancePath + '/source/suggestionId',
              schemaPath: '#/$defs/ItemSource/properties/suggestionId/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err58];
            } else {
              vErrors.push(err58);
            }
            errors++;
          }
        }
        if (data18.verificationResultId !== undefined) {
          let data21 = data18.verificationResultId;
          if (typeof data21 === 'string') {
            if (!formats10.test(data21)) {
              const err59 = {
                instancePath: instancePath + '/source/verificationResultId',
                schemaPath: '#/$defs/ItemSource/properties/verificationResultId/format',
                keyword: 'format',
                params: { format: 'uuid' },
                message: 'must match format "' + 'uuid' + '"',
              };
              if (vErrors === null) {
                vErrors = [err59];
              } else {
                vErrors.push(err59);
              }
              errors++;
            }
          } else {
            const err60 = {
              instancePath: instancePath + '/source/verificationResultId',
              schemaPath: '#/$defs/ItemSource/properties/verificationResultId/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err60];
            } else {
              vErrors.push(err60);
            }
            errors++;
          }
        }
        if (data18.aiJobId !== undefined) {
          let data22 = data18.aiJobId;
          if (typeof data22 === 'string') {
            if (!formats10.test(data22)) {
              const err61 = {
                instancePath: instancePath + '/source/aiJobId',
                schemaPath: '#/$defs/ItemSource/properties/aiJobId/format',
                keyword: 'format',
                params: { format: 'uuid' },
                message: 'must match format "' + 'uuid' + '"',
              };
              if (vErrors === null) {
                vErrors = [err61];
              } else {
                vErrors.push(err61);
              }
              errors++;
            }
          } else {
            const err62 = {
              instancePath: instancePath + '/source/aiJobId',
              schemaPath: '#/$defs/ItemSource/properties/aiJobId/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err62];
            } else {
              vErrors.push(err62);
            }
            errors++;
          }
        }
        if (data18.at !== undefined) {
          let data23 = data18.at;
          if (typeof data23 === 'string') {
            if (!formats32.validate(data23)) {
              const err63 = {
                instancePath: instancePath + '/source/at',
                schemaPath: '#/$defs/ItemSource/properties/at/format',
                keyword: 'format',
                params: { format: 'date-time' },
                message: 'must match format "' + 'date-time' + '"',
              };
              if (vErrors === null) {
                vErrors = [err63];
              } else {
                vErrors.push(err63);
              }
              errors++;
            }
          } else {
            const err64 = {
              instancePath: instancePath + '/source/at',
              schemaPath: '#/$defs/ItemSource/properties/at/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err64];
            } else {
              vErrors.push(err64);
            }
            errors++;
          }
        }
      } else {
        const err65 = {
          instancePath: instancePath + '/source',
          schemaPath: '#/$defs/ItemSource/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err65];
        } else {
          vErrors.push(err65);
        }
        errors++;
      }
    }
    if (data.attachments !== undefined) {
      let data24 = data.attachments;
      if (Array.isArray(data24)) {
        const len0 = data24.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data25 = data24[i0];
          if (data25 && typeof data25 == 'object' && !Array.isArray(data25)) {
            if (data25.attachmentId === undefined) {
              const err66 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'attachmentId' },
                message: "must have required property '" + 'attachmentId' + "'",
              };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
            if (data25.uploadId === undefined) {
              const err67 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'uploadId' },
                message: "must have required property '" + 'uploadId' + "'",
              };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
            if (data25.fileName === undefined) {
              const err68 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'fileName' },
                message: "must have required property '" + 'fileName' + "'",
              };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
            }
            if (data25.sha256 === undefined) {
              const err69 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'sha256' },
                message: "must have required property '" + 'sha256' + "'",
              };
              if (vErrors === null) {
                vErrors = [err69];
              } else {
                vErrors.push(err69);
              }
              errors++;
            }
            for (const key6 in data25) {
              if (!(
                key6 === 'attachmentId' ||
                key6 === 'uploadId' ||
                key6 === 'fileName' ||
                key6 === 'sha256'
              )) {
                const err70 = {
                  instancePath: instancePath + '/attachments/' + i0,
                  schemaPath: '#/$defs/Attachment/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key6 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err70];
                } else {
                  vErrors.push(err70);
                }
                errors++;
              }
            }
            if (data25.attachmentId !== undefined) {
              let data26 = data25.attachmentId;
              if (typeof data26 === 'string') {
                if (!formats10.test(data26)) {
                  const err71 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/attachmentId',
                    schemaPath: '#/$defs/Attachment/properties/attachmentId/format',
                    keyword: 'format',
                    params: { format: 'uuid' },
                    message: 'must match format "' + 'uuid' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err71];
                  } else {
                    vErrors.push(err71);
                  }
                  errors++;
                }
              } else {
                const err72 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/attachmentId',
                  schemaPath: '#/$defs/Attachment/properties/attachmentId/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err72];
                } else {
                  vErrors.push(err72);
                }
                errors++;
              }
            }
            if (data25.uploadId !== undefined) {
              let data27 = data25.uploadId;
              if (typeof data27 === 'string') {
                if (!formats10.test(data27)) {
                  const err73 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/uploadId',
                    schemaPath: '#/$defs/Attachment/properties/uploadId/format',
                    keyword: 'format',
                    params: { format: 'uuid' },
                    message: 'must match format "' + 'uuid' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err73];
                  } else {
                    vErrors.push(err73);
                  }
                  errors++;
                }
              } else {
                const err74 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/uploadId',
                  schemaPath: '#/$defs/Attachment/properties/uploadId/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err74];
                } else {
                  vErrors.push(err74);
                }
                errors++;
              }
            }
            if (data25.fileName !== undefined) {
              let data28 = data25.fileName;
              if (typeof data28 === 'string') {
                if (func2(data28) > 255) {
                  const err75 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/fileName',
                    schemaPath: '#/$defs/Attachment/properties/fileName/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 255 },
                    message: 'must NOT have more than 255 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err75];
                  } else {
                    vErrors.push(err75);
                  }
                  errors++;
                }
              } else {
                const err76 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/fileName',
                  schemaPath: '#/$defs/Attachment/properties/fileName/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err76];
                } else {
                  vErrors.push(err76);
                }
                errors++;
              }
            }
            if (data25.sha256 !== undefined) {
              let data29 = data25.sha256;
              if (typeof data29 === 'string') {
                if (!pattern12.test(data29)) {
                  const err77 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/sha256',
                    schemaPath: '#/$defs/Attachment/properties/sha256/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^[0-9a-f]{64}$' },
                    message: 'must match pattern "' + '^[0-9a-f]{64}$' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err77];
                  } else {
                    vErrors.push(err77);
                  }
                  errors++;
                }
              } else {
                const err78 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/sha256',
                  schemaPath: '#/$defs/Attachment/properties/sha256/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err78];
                } else {
                  vErrors.push(err78);
                }
                errors++;
              }
            }
          } else {
            const err79 = {
              instancePath: instancePath + '/attachments/' + i0,
              schemaPath: '#/$defs/Attachment/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err79];
            } else {
              vErrors.push(err79);
            }
            errors++;
          }
        }
      } else {
        const err80 = {
          instancePath: instancePath + '/attachments',
          schemaPath: '#/properties/attachments/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err80];
        } else {
          vErrors.push(err80);
        }
        errors++;
      }
    }
  } else {
    const err81 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err81];
    } else {
      vErrors.push(err81);
    }
    errors++;
  }
  validate26.errors = vErrors;
  return errors === 0;
}
validate26.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema47 = {
  type: 'object',
  required: ['id', 'type', 'description', 'value', 'location', 'joint', 'change'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    type: {
      type: 'string',
      enum: [
        'land',
        'building',
        'vehicle',
        'securities',
        'shareholding',
        'bank-account',
        'cash',
        'receivable',
        'other',
      ],
    },
    description: { type: 'string', minLength: 1, maxLength: 200 },
    details: {
      type: 'object',
      description: 'Type-specific identifiers; no account numbers',
      additionalProperties: false,
      properties: {
        parcelNumber: { type: 'string', maxLength: 100 },
        size: { type: 'string', maxLength: 50 },
        registration: { type: 'string', maxLength: 20 },
        makeModel: { type: 'string', maxLength: 100 },
        issuer: { type: 'string', maxLength: 200 },
        quantityOrPercent: { type: 'string', maxLength: 50 },
        institution: { type: 'string', maxLength: 200 },
        accountType: { type: 'string', maxLength: 50 },
        debtor: { type: 'string', maxLength: 200 },
      },
    },
    value: { $ref: '#/$defs/Money' },
    location: { $ref: '#/$defs/Location' },
    joint: {
      type: 'object',
      required: ['isJoint'],
      additionalProperties: false,
      properties: {
        isJoint: { type: 'boolean' },
        sharePercent: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
        coOwner: { type: 'string', maxLength: 200 },
      },
      if: { properties: { isJoint: { const: true } } },
      then: { required: ['isJoint', 'sharePercent'] },
    },
    change: { $ref: '#/$defs/ChangeFlag' },
    source: { $ref: '#/$defs/ItemSource' },
    attachments: { type: 'array', items: { $ref: '#/$defs/Attachment' } },
  },
};
function validate28(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate28.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.id === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'id' },
        message: "must have required property '" + 'id' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'type' },
        message: "must have required property '" + 'type' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.description === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'description' },
        message: "must have required property '" + 'description' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.value === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'value' },
        message: "must have required property '" + 'value' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.location === undefined) {
      const err4 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'location' },
        message: "must have required property '" + 'location' + "'",
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.joint === undefined) {
      const err5 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'joint' },
        message: "must have required property '" + 'joint' + "'",
      };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.change === undefined) {
      const err6 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'change' },
        message: "must have required property '" + 'change' + "'",
      };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema47.properties, key0)) {
        const err7 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== undefined) {
      let data0 = data.id;
      if (typeof data0 === 'string') {
        if (!formats10.test(data0)) {
          const err8 = {
            instancePath: instancePath + '/id',
            schemaPath: '#/properties/id/format',
            keyword: 'format',
            params: { format: 'uuid' },
            message: 'must match format "' + 'uuid' + '"',
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = {
          instancePath: instancePath + '/id',
          schemaPath: '#/properties/id/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.type !== undefined) {
      let data1 = data.type;
      if (typeof data1 !== 'string') {
        const err10 = {
          instancePath: instancePath + '/type',
          schemaPath: '#/properties/type/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
      if (!(
        data1 === 'land' ||
        data1 === 'building' ||
        data1 === 'vehicle' ||
        data1 === 'securities' ||
        data1 === 'shareholding' ||
        data1 === 'bank-account' ||
        data1 === 'cash' ||
        data1 === 'receivable' ||
        data1 === 'other'
      )) {
        const err11 = {
          instancePath: instancePath + '/type',
          schemaPath: '#/properties/type/enum',
          keyword: 'enum',
          params: { allowedValues: schema47.properties.type.enum },
          message: 'must be equal to one of the allowed values',
        };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.description !== undefined) {
      let data2 = data.description;
      if (typeof data2 === 'string') {
        if (func2(data2) > 200) {
          const err12 = {
            instancePath: instancePath + '/description',
            schemaPath: '#/properties/description/maxLength',
            keyword: 'maxLength',
            params: { limit: 200 },
            message: 'must NOT have more than 200 characters',
          };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (func2(data2) < 1) {
          const err13 = {
            instancePath: instancePath + '/description',
            schemaPath: '#/properties/description/minLength',
            keyword: 'minLength',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 characters',
          };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = {
          instancePath: instancePath + '/description',
          schemaPath: '#/properties/description/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.details !== undefined) {
      let data3 = data.details;
      if (data3 && typeof data3 == 'object' && !Array.isArray(data3)) {
        for (const key1 in data3) {
          if (!func1.call(schema47.properties.details.properties, key1)) {
            const err15 = {
              instancePath: instancePath + '/details',
              schemaPath: '#/properties/details/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err15];
            } else {
              vErrors.push(err15);
            }
            errors++;
          }
        }
        if (data3.parcelNumber !== undefined) {
          let data4 = data3.parcelNumber;
          if (typeof data4 === 'string') {
            if (func2(data4) > 100) {
              const err16 = {
                instancePath: instancePath + '/details/parcelNumber',
                schemaPath: '#/properties/details/properties/parcelNumber/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err16];
              } else {
                vErrors.push(err16);
              }
              errors++;
            }
          } else {
            const err17 = {
              instancePath: instancePath + '/details/parcelNumber',
              schemaPath: '#/properties/details/properties/parcelNumber/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
        }
        if (data3.size !== undefined) {
          let data5 = data3.size;
          if (typeof data5 === 'string') {
            if (func2(data5) > 50) {
              const err18 = {
                instancePath: instancePath + '/details/size',
                schemaPath: '#/properties/details/properties/size/maxLength',
                keyword: 'maxLength',
                params: { limit: 50 },
                message: 'must NOT have more than 50 characters',
              };
              if (vErrors === null) {
                vErrors = [err18];
              } else {
                vErrors.push(err18);
              }
              errors++;
            }
          } else {
            const err19 = {
              instancePath: instancePath + '/details/size',
              schemaPath: '#/properties/details/properties/size/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err19];
            } else {
              vErrors.push(err19);
            }
            errors++;
          }
        }
        if (data3.registration !== undefined) {
          let data6 = data3.registration;
          if (typeof data6 === 'string') {
            if (func2(data6) > 20) {
              const err20 = {
                instancePath: instancePath + '/details/registration',
                schemaPath: '#/properties/details/properties/registration/maxLength',
                keyword: 'maxLength',
                params: { limit: 20 },
                message: 'must NOT have more than 20 characters',
              };
              if (vErrors === null) {
                vErrors = [err20];
              } else {
                vErrors.push(err20);
              }
              errors++;
            }
          } else {
            const err21 = {
              instancePath: instancePath + '/details/registration',
              schemaPath: '#/properties/details/properties/registration/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err21];
            } else {
              vErrors.push(err21);
            }
            errors++;
          }
        }
        if (data3.makeModel !== undefined) {
          let data7 = data3.makeModel;
          if (typeof data7 === 'string') {
            if (func2(data7) > 100) {
              const err22 = {
                instancePath: instancePath + '/details/makeModel',
                schemaPath: '#/properties/details/properties/makeModel/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
          } else {
            const err23 = {
              instancePath: instancePath + '/details/makeModel',
              schemaPath: '#/properties/details/properties/makeModel/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err23];
            } else {
              vErrors.push(err23);
            }
            errors++;
          }
        }
        if (data3.issuer !== undefined) {
          let data8 = data3.issuer;
          if (typeof data8 === 'string') {
            if (func2(data8) > 200) {
              const err24 = {
                instancePath: instancePath + '/details/issuer',
                schemaPath: '#/properties/details/properties/issuer/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
          } else {
            const err25 = {
              instancePath: instancePath + '/details/issuer',
              schemaPath: '#/properties/details/properties/issuer/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err25];
            } else {
              vErrors.push(err25);
            }
            errors++;
          }
        }
        if (data3.quantityOrPercent !== undefined) {
          let data9 = data3.quantityOrPercent;
          if (typeof data9 === 'string') {
            if (func2(data9) > 50) {
              const err26 = {
                instancePath: instancePath + '/details/quantityOrPercent',
                schemaPath: '#/properties/details/properties/quantityOrPercent/maxLength',
                keyword: 'maxLength',
                params: { limit: 50 },
                message: 'must NOT have more than 50 characters',
              };
              if (vErrors === null) {
                vErrors = [err26];
              } else {
                vErrors.push(err26);
              }
              errors++;
            }
          } else {
            const err27 = {
              instancePath: instancePath + '/details/quantityOrPercent',
              schemaPath: '#/properties/details/properties/quantityOrPercent/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err27];
            } else {
              vErrors.push(err27);
            }
            errors++;
          }
        }
        if (data3.institution !== undefined) {
          let data10 = data3.institution;
          if (typeof data10 === 'string') {
            if (func2(data10) > 200) {
              const err28 = {
                instancePath: instancePath + '/details/institution',
                schemaPath: '#/properties/details/properties/institution/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err28];
              } else {
                vErrors.push(err28);
              }
              errors++;
            }
          } else {
            const err29 = {
              instancePath: instancePath + '/details/institution',
              schemaPath: '#/properties/details/properties/institution/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err29];
            } else {
              vErrors.push(err29);
            }
            errors++;
          }
        }
        if (data3.accountType !== undefined) {
          let data11 = data3.accountType;
          if (typeof data11 === 'string') {
            if (func2(data11) > 50) {
              const err30 = {
                instancePath: instancePath + '/details/accountType',
                schemaPath: '#/properties/details/properties/accountType/maxLength',
                keyword: 'maxLength',
                params: { limit: 50 },
                message: 'must NOT have more than 50 characters',
              };
              if (vErrors === null) {
                vErrors = [err30];
              } else {
                vErrors.push(err30);
              }
              errors++;
            }
          } else {
            const err31 = {
              instancePath: instancePath + '/details/accountType',
              schemaPath: '#/properties/details/properties/accountType/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err31];
            } else {
              vErrors.push(err31);
            }
            errors++;
          }
        }
        if (data3.debtor !== undefined) {
          let data12 = data3.debtor;
          if (typeof data12 === 'string') {
            if (func2(data12) > 200) {
              const err32 = {
                instancePath: instancePath + '/details/debtor',
                schemaPath: '#/properties/details/properties/debtor/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err32];
              } else {
                vErrors.push(err32);
              }
              errors++;
            }
          } else {
            const err33 = {
              instancePath: instancePath + '/details/debtor',
              schemaPath: '#/properties/details/properties/debtor/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err33];
            } else {
              vErrors.push(err33);
            }
            errors++;
          }
        }
      } else {
        const err34 = {
          instancePath: instancePath + '/details',
          schemaPath: '#/properties/details/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
    }
    if (data.value !== undefined) {
      let data13 = data.value;
      if (data13 && typeof data13 == 'object' && !Array.isArray(data13)) {
        if (data13.kesCents === undefined) {
          const err35 = {
            instancePath: instancePath + '/value',
            schemaPath: '#/$defs/Money/required',
            keyword: 'required',
            params: { missingProperty: 'kesCents' },
            message: "must have required property '" + 'kesCents' + "'",
          };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
        for (const key2 in data13) {
          if (!(key2 === 'kesCents' || key2 === 'original')) {
            const err36 = {
              instancePath: instancePath + '/value',
              schemaPath: '#/$defs/Money/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key2 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err36];
            } else {
              vErrors.push(err36);
            }
            errors++;
          }
        }
        if (data13.kesCents !== undefined) {
          let data14 = data13.kesCents;
          if (!(typeof data14 == 'number' && !(data14 % 1) && !isNaN(data14) && isFinite(data14))) {
            const err37 = {
              instancePath: instancePath + '/value/kesCents',
              schemaPath: '#/$defs/Money/properties/kesCents/type',
              keyword: 'type',
              params: { type: 'integer' },
              message: 'must be integer',
            };
            if (vErrors === null) {
              vErrors = [err37];
            } else {
              vErrors.push(err37);
            }
            errors++;
          }
          if (typeof data14 == 'number' && isFinite(data14)) {
            if (data14 < 0 || isNaN(data14)) {
              const err38 = {
                instancePath: instancePath + '/value/kesCents',
                schemaPath: '#/$defs/Money/properties/kesCents/minimum',
                keyword: 'minimum',
                params: { comparison: '>=', limit: 0 },
                message: 'must be >= 0',
              };
              if (vErrors === null) {
                vErrors = [err38];
              } else {
                vErrors.push(err38);
              }
              errors++;
            }
          }
        }
        if (data13.original !== undefined) {
          let data15 = data13.original;
          if (data15 && typeof data15 == 'object' && !Array.isArray(data15)) {
            if (data15.currency === undefined) {
              const err39 = {
                instancePath: instancePath + '/value/original',
                schemaPath: '#/$defs/Money/properties/original/required',
                keyword: 'required',
                params: { missingProperty: 'currency' },
                message: "must have required property '" + 'currency' + "'",
              };
              if (vErrors === null) {
                vErrors = [err39];
              } else {
                vErrors.push(err39);
              }
              errors++;
            }
            if (data15.minorUnits === undefined) {
              const err40 = {
                instancePath: instancePath + '/value/original',
                schemaPath: '#/$defs/Money/properties/original/required',
                keyword: 'required',
                params: { missingProperty: 'minorUnits' },
                message: "must have required property '" + 'minorUnits' + "'",
              };
              if (vErrors === null) {
                vErrors = [err40];
              } else {
                vErrors.push(err40);
              }
              errors++;
            }
            for (const key3 in data15) {
              if (!(key3 === 'currency' || key3 === 'minorUnits')) {
                const err41 = {
                  instancePath: instancePath + '/value/original',
                  schemaPath: '#/$defs/Money/properties/original/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key3 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err41];
                } else {
                  vErrors.push(err41);
                }
                errors++;
              }
            }
            if (data15.currency !== undefined) {
              let data16 = data15.currency;
              if (typeof data16 === 'string') {
                if (!pattern9.test(data16)) {
                  const err42 = {
                    instancePath: instancePath + '/value/original/currency',
                    schemaPath: '#/$defs/Money/properties/original/properties/currency/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^[A-Z]{3}$' },
                    message: 'must match pattern "' + '^[A-Z]{3}$' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err42];
                  } else {
                    vErrors.push(err42);
                  }
                  errors++;
                }
              } else {
                const err43 = {
                  instancePath: instancePath + '/value/original/currency',
                  schemaPath: '#/$defs/Money/properties/original/properties/currency/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err43];
                } else {
                  vErrors.push(err43);
                }
                errors++;
              }
            }
            if (data15.minorUnits !== undefined) {
              let data17 = data15.minorUnits;
              if (!(
                typeof data17 == 'number' &&
                !(data17 % 1) &&
                !isNaN(data17) &&
                isFinite(data17)
              )) {
                const err44 = {
                  instancePath: instancePath + '/value/original/minorUnits',
                  schemaPath: '#/$defs/Money/properties/original/properties/minorUnits/type',
                  keyword: 'type',
                  params: { type: 'integer' },
                  message: 'must be integer',
                };
                if (vErrors === null) {
                  vErrors = [err44];
                } else {
                  vErrors.push(err44);
                }
                errors++;
              }
              if (typeof data17 == 'number' && isFinite(data17)) {
                if (data17 < 0 || isNaN(data17)) {
                  const err45 = {
                    instancePath: instancePath + '/value/original/minorUnits',
                    schemaPath: '#/$defs/Money/properties/original/properties/minorUnits/minimum',
                    keyword: 'minimum',
                    params: { comparison: '>=', limit: 0 },
                    message: 'must be >= 0',
                  };
                  if (vErrors === null) {
                    vErrors = [err45];
                  } else {
                    vErrors.push(err45);
                  }
                  errors++;
                }
              }
            }
          } else {
            const err46 = {
              instancePath: instancePath + '/value/original',
              schemaPath: '#/$defs/Money/properties/original/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err46];
            } else {
              vErrors.push(err46);
            }
            errors++;
          }
        }
      } else {
        const err47 = {
          instancePath: instancePath + '/value',
          schemaPath: '#/$defs/Money/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err47];
        } else {
          vErrors.push(err47);
        }
        errors++;
      }
    }
    if (data.location !== undefined) {
      let data18 = data.location;
      if (data18 && typeof data18 == 'object' && !Array.isArray(data18)) {
        if (data18.inKenya === undefined) {
          const err48 = {
            instancePath: instancePath + '/location',
            schemaPath: '#/$defs/Location/required',
            keyword: 'required',
            params: { missingProperty: 'inKenya' },
            message: "must have required property '" + 'inKenya' + "'",
          };
          if (vErrors === null) {
            vErrors = [err48];
          } else {
            vErrors.push(err48);
          }
          errors++;
        }
        for (const key4 in data18) {
          if (!(
            key4 === 'inKenya' ||
            key4 === 'county' ||
            key4 === 'country' ||
            key4 === 'detail'
          )) {
            const err49 = {
              instancePath: instancePath + '/location',
              schemaPath: '#/$defs/Location/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key4 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err49];
            } else {
              vErrors.push(err49);
            }
            errors++;
          }
        }
        if (data18.inKenya !== undefined) {
          if (typeof data18.inKenya !== 'boolean') {
            const err50 = {
              instancePath: instancePath + '/location/inKenya',
              schemaPath: '#/$defs/Location/properties/inKenya/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err50];
            } else {
              vErrors.push(err50);
            }
            errors++;
          }
        }
        if (data18.county !== undefined) {
          let data20 = data18.county;
          if (typeof data20 === 'string') {
            if (!pattern10.test(data20)) {
              const err51 = {
                instancePath: instancePath + '/location/county',
                schemaPath: '#/$defs/Location/properties/county/pattern',
                keyword: 'pattern',
                params: { pattern: '^0(0[1-9]|[1-3][0-9]|4[0-7])$' },
                message: 'must match pattern "' + '^0(0[1-9]|[1-3][0-9]|4[0-7])$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err51];
              } else {
                vErrors.push(err51);
              }
              errors++;
            }
          } else {
            const err52 = {
              instancePath: instancePath + '/location/county',
              schemaPath: '#/$defs/Location/properties/county/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err52];
            } else {
              vErrors.push(err52);
            }
            errors++;
          }
        }
        if (data18.country !== undefined) {
          let data21 = data18.country;
          if (typeof data21 === 'string') {
            if (!pattern11.test(data21)) {
              const err53 = {
                instancePath: instancePath + '/location/country',
                schemaPath: '#/$defs/Location/properties/country/pattern',
                keyword: 'pattern',
                params: { pattern: '^[A-Z]{2}$' },
                message: 'must match pattern "' + '^[A-Z]{2}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err53];
              } else {
                vErrors.push(err53);
              }
              errors++;
            }
          } else {
            const err54 = {
              instancePath: instancePath + '/location/country',
              schemaPath: '#/$defs/Location/properties/country/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err54];
            } else {
              vErrors.push(err54);
            }
            errors++;
          }
        }
        if (data18.detail !== undefined) {
          let data22 = data18.detail;
          if (typeof data22 === 'string') {
            if (func2(data22) > 200) {
              const err55 = {
                instancePath: instancePath + '/location/detail',
                schemaPath: '#/$defs/Location/properties/detail/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err55];
              } else {
                vErrors.push(err55);
              }
              errors++;
            }
          } else {
            const err56 = {
              instancePath: instancePath + '/location/detail',
              schemaPath: '#/$defs/Location/properties/detail/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err56];
            } else {
              vErrors.push(err56);
            }
            errors++;
          }
        }
      } else {
        const err57 = {
          instancePath: instancePath + '/location',
          schemaPath: '#/$defs/Location/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err57];
        } else {
          vErrors.push(err57);
        }
        errors++;
      }
    }
    if (data.joint !== undefined) {
      let data23 = data.joint;
      const _errs56 = errors;
      let valid7 = true;
      const _errs57 = errors;
      if (data23 && typeof data23 == 'object' && !Array.isArray(data23)) {
        if (data23.isJoint !== undefined) {
          if (true !== data23.isJoint) {
            const err58 = {};
            if (vErrors === null) {
              vErrors = [err58];
            } else {
              vErrors.push(err58);
            }
            errors++;
          }
        }
      }
      var _valid0 = _errs57 === errors;
      errors = _errs56;
      if (vErrors !== null) {
        if (_errs56) {
          vErrors.length = _errs56;
        } else {
          vErrors = null;
        }
      }
      if (_valid0) {
        const _errs59 = errors;
        if (data23 && typeof data23 == 'object' && !Array.isArray(data23)) {
          if (data23.isJoint === undefined) {
            const err59 = {
              instancePath: instancePath + '/joint',
              schemaPath: '#/properties/joint/then/required',
              keyword: 'required',
              params: { missingProperty: 'isJoint' },
              message: "must have required property '" + 'isJoint' + "'",
            };
            if (vErrors === null) {
              vErrors = [err59];
            } else {
              vErrors.push(err59);
            }
            errors++;
          }
          if (data23.sharePercent === undefined) {
            const err60 = {
              instancePath: instancePath + '/joint',
              schemaPath: '#/properties/joint/then/required',
              keyword: 'required',
              params: { missingProperty: 'sharePercent' },
              message: "must have required property '" + 'sharePercent' + "'",
            };
            if (vErrors === null) {
              vErrors = [err60];
            } else {
              vErrors.push(err60);
            }
            errors++;
          }
        }
        var _valid0 = _errs59 === errors;
        valid7 = _valid0;
      }
      if (!valid7) {
        const err61 = {
          instancePath: instancePath + '/joint',
          schemaPath: '#/properties/joint/if',
          keyword: 'if',
          params: { failingKeyword: 'then' },
          message: 'must match "then" schema',
        };
        if (vErrors === null) {
          vErrors = [err61];
        } else {
          vErrors.push(err61);
        }
        errors++;
      }
      if (data23 && typeof data23 == 'object' && !Array.isArray(data23)) {
        if (data23.isJoint === undefined) {
          const err62 = {
            instancePath: instancePath + '/joint',
            schemaPath: '#/properties/joint/required',
            keyword: 'required',
            params: { missingProperty: 'isJoint' },
            message: "must have required property '" + 'isJoint' + "'",
          };
          if (vErrors === null) {
            vErrors = [err62];
          } else {
            vErrors.push(err62);
          }
          errors++;
        }
        for (const key5 in data23) {
          if (!(key5 === 'isJoint' || key5 === 'sharePercent' || key5 === 'coOwner')) {
            const err63 = {
              instancePath: instancePath + '/joint',
              schemaPath: '#/properties/joint/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key5 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
        }
        if (data23.isJoint !== undefined) {
          if (typeof data23.isJoint !== 'boolean') {
            const err64 = {
              instancePath: instancePath + '/joint/isJoint',
              schemaPath: '#/properties/joint/properties/isJoint/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err64];
            } else {
              vErrors.push(err64);
            }
            errors++;
          }
        }
        if (data23.sharePercent !== undefined) {
          let data26 = data23.sharePercent;
          if (typeof data26 == 'number' && isFinite(data26)) {
            if (data26 > 100 || isNaN(data26)) {
              const err65 = {
                instancePath: instancePath + '/joint/sharePercent',
                schemaPath: '#/properties/joint/properties/sharePercent/maximum',
                keyword: 'maximum',
                params: { comparison: '<=', limit: 100 },
                message: 'must be <= 100',
              };
              if (vErrors === null) {
                vErrors = [err65];
              } else {
                vErrors.push(err65);
              }
              errors++;
            }
            if (data26 <= 0 || isNaN(data26)) {
              const err66 = {
                instancePath: instancePath + '/joint/sharePercent',
                schemaPath: '#/properties/joint/properties/sharePercent/exclusiveMinimum',
                keyword: 'exclusiveMinimum',
                params: { comparison: '>', limit: 0 },
                message: 'must be > 0',
              };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
          } else {
            const err67 = {
              instancePath: instancePath + '/joint/sharePercent',
              schemaPath: '#/properties/joint/properties/sharePercent/type',
              keyword: 'type',
              params: { type: 'number' },
              message: 'must be number',
            };
            if (vErrors === null) {
              vErrors = [err67];
            } else {
              vErrors.push(err67);
            }
            errors++;
          }
        }
        if (data23.coOwner !== undefined) {
          let data27 = data23.coOwner;
          if (typeof data27 === 'string') {
            if (func2(data27) > 200) {
              const err68 = {
                instancePath: instancePath + '/joint/coOwner',
                schemaPath: '#/properties/joint/properties/coOwner/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
            }
          } else {
            const err69 = {
              instancePath: instancePath + '/joint/coOwner',
              schemaPath: '#/properties/joint/properties/coOwner/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err69];
            } else {
              vErrors.push(err69);
            }
            errors++;
          }
        }
      } else {
        const err70 = {
          instancePath: instancePath + '/joint',
          schemaPath: '#/properties/joint/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err70];
        } else {
          vErrors.push(err70);
        }
        errors++;
      }
    }
    if (data.change !== undefined) {
      let data28 = data.change;
      const _errs70 = errors;
      let valid11 = true;
      const _errs71 = errors;
      if (data28 && typeof data28 == 'object' && !Array.isArray(data28)) {
        if (data28.changed !== undefined) {
          if (true !== data28.changed) {
            const err71 = {};
            if (vErrors === null) {
              vErrors = [err71];
            } else {
              vErrors.push(err71);
            }
            errors++;
          }
        }
      }
      var _valid1 = _errs71 === errors;
      errors = _errs70;
      if (vErrors !== null) {
        if (_errs70) {
          vErrors.length = _errs70;
        } else {
          vErrors = null;
        }
      }
      if (_valid1) {
        const _errs73 = errors;
        if (data28 && typeof data28 == 'object' && !Array.isArray(data28)) {
          if (data28.changed === undefined) {
            const err72 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/then/required',
              keyword: 'required',
              params: { missingProperty: 'changed' },
              message: "must have required property '" + 'changed' + "'",
            };
            if (vErrors === null) {
              vErrors = [err72];
            } else {
              vErrors.push(err72);
            }
            errors++;
          }
          if (data28.kind === undefined) {
            const err73 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/then/required',
              keyword: 'required',
              params: { missingProperty: 'kind' },
              message: "must have required property '" + 'kind' + "'",
            };
            if (vErrors === null) {
              vErrors = [err73];
            } else {
              vErrors.push(err73);
            }
            errors++;
          }
          if (data28.explanation === undefined) {
            const err74 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/then/required',
              keyword: 'required',
              params: { missingProperty: 'explanation' },
              message: "must have required property '" + 'explanation' + "'",
            };
            if (vErrors === null) {
              vErrors = [err74];
            } else {
              vErrors.push(err74);
            }
            errors++;
          }
        }
        var _valid1 = _errs73 === errors;
        valid11 = _valid1;
      }
      if (!valid11) {
        const err75 = {
          instancePath: instancePath + '/change',
          schemaPath: '#/$defs/ChangeFlag/if',
          keyword: 'if',
          params: { failingKeyword: 'then' },
          message: 'must match "then" schema',
        };
        if (vErrors === null) {
          vErrors = [err75];
        } else {
          vErrors.push(err75);
        }
        errors++;
      }
      if (data28 && typeof data28 == 'object' && !Array.isArray(data28)) {
        if (data28.changed === undefined) {
          const err76 = {
            instancePath: instancePath + '/change',
            schemaPath: '#/$defs/ChangeFlag/required',
            keyword: 'required',
            params: { missingProperty: 'changed' },
            message: "must have required property '" + 'changed' + "'",
          };
          if (vErrors === null) {
            vErrors = [err76];
          } else {
            vErrors.push(err76);
          }
          errors++;
        }
        for (const key6 in data28) {
          if (!(key6 === 'changed' || key6 === 'kind' || key6 === 'explanation')) {
            const err77 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key6 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err77];
            } else {
              vErrors.push(err77);
            }
            errors++;
          }
        }
        if (data28.changed !== undefined) {
          if (typeof data28.changed !== 'boolean') {
            const err78 = {
              instancePath: instancePath + '/change/changed',
              schemaPath: '#/$defs/ChangeFlag/properties/changed/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err78];
            } else {
              vErrors.push(err78);
            }
            errors++;
          }
        }
        if (data28.kind !== undefined) {
          let data31 = data28.kind;
          if (typeof data31 !== 'string') {
            const err79 = {
              instancePath: instancePath + '/change/kind',
              schemaPath: '#/$defs/ChangeFlag/properties/kind/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err79];
            } else {
              vErrors.push(err79);
            }
            errors++;
          }
          if (!(
            data31 === 'value-change' ||
            data31 === 'acquisition' ||
            data31 === 'disposal' ||
            data31 === 'new-source' ||
            data31 === 'source-ended' ||
            data31 === 'settled'
          )) {
            const err80 = {
              instancePath: instancePath + '/change/kind',
              schemaPath: '#/$defs/ChangeFlag/properties/kind/enum',
              keyword: 'enum',
              params: { allowedValues: schema44.properties.kind.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err80];
            } else {
              vErrors.push(err80);
            }
            errors++;
          }
        }
        if (data28.explanation !== undefined) {
          let data32 = data28.explanation;
          if (typeof data32 === 'string') {
            if (func2(data32) > 1000) {
              const err81 = {
                instancePath: instancePath + '/change/explanation',
                schemaPath: '#/$defs/ChangeFlag/properties/explanation/maxLength',
                keyword: 'maxLength',
                params: { limit: 1000 },
                message: 'must NOT have more than 1000 characters',
              };
              if (vErrors === null) {
                vErrors = [err81];
              } else {
                vErrors.push(err81);
              }
              errors++;
            }
            if (func2(data32) < 1) {
              const err82 = {
                instancePath: instancePath + '/change/explanation',
                schemaPath: '#/$defs/ChangeFlag/properties/explanation/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err82];
              } else {
                vErrors.push(err82);
              }
              errors++;
            }
          } else {
            const err83 = {
              instancePath: instancePath + '/change/explanation',
              schemaPath: '#/$defs/ChangeFlag/properties/explanation/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err83];
            } else {
              vErrors.push(err83);
            }
            errors++;
          }
        }
      } else {
        const err84 = {
          instancePath: instancePath + '/change',
          schemaPath: '#/$defs/ChangeFlag/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err84];
        } else {
          vErrors.push(err84);
        }
        errors++;
      }
    }
    if (data.source !== undefined) {
      let data33 = data.source;
      if (data33 && typeof data33 == 'object' && !Array.isArray(data33)) {
        if (data33.kind === undefined) {
          const err85 = {
            instancePath: instancePath + '/source',
            schemaPath: '#/$defs/ItemSource/required',
            keyword: 'required',
            params: { missingProperty: 'kind' },
            message: "must have required property '" + 'kind' + "'",
          };
          if (vErrors === null) {
            vErrors = [err85];
          } else {
            vErrors.push(err85);
          }
          errors++;
        }
        if (data33.suggestionId === undefined) {
          const err86 = {
            instancePath: instancePath + '/source',
            schemaPath: '#/$defs/ItemSource/required',
            keyword: 'required',
            params: { missingProperty: 'suggestionId' },
            message: "must have required property '" + 'suggestionId' + "'",
          };
          if (vErrors === null) {
            vErrors = [err86];
          } else {
            vErrors.push(err86);
          }
          errors++;
        }
        if (data33.at === undefined) {
          const err87 = {
            instancePath: instancePath + '/source',
            schemaPath: '#/$defs/ItemSource/required',
            keyword: 'required',
            params: { missingProperty: 'at' },
            message: "must have required property '" + 'at' + "'",
          };
          if (vErrors === null) {
            vErrors = [err87];
          } else {
            vErrors.push(err87);
          }
          errors++;
        }
        for (const key7 in data33) {
          if (!(
            key7 === 'kind' ||
            key7 === 'suggestionId' ||
            key7 === 'verificationResultId' ||
            key7 === 'aiJobId' ||
            key7 === 'at'
          )) {
            const err88 = {
              instancePath: instancePath + '/source',
              schemaPath: '#/$defs/ItemSource/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key7 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err88];
            } else {
              vErrors.push(err88);
            }
            errors++;
          }
        }
        if (data33.kind !== undefined) {
          let data34 = data33.kind;
          if (typeof data34 !== 'string') {
            const err89 = {
              instancePath: instancePath + '/source/kind',
              schemaPath: '#/$defs/ItemSource/properties/kind/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err89];
            } else {
              vErrors.push(err89);
            }
            errors++;
          }
          if (!(
            data34 === 'kra' ||
            data34 === 'ntsa' ||
            data34 === 'brs' ||
            data34 === 'ardhisasa' ||
            data34 === 'document'
          )) {
            const err90 = {
              instancePath: instancePath + '/source/kind',
              schemaPath: '#/$defs/ItemSource/properties/kind/enum',
              keyword: 'enum',
              params: { allowedValues: schema45.properties.kind.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err90];
            } else {
              vErrors.push(err90);
            }
            errors++;
          }
        }
        if (data33.suggestionId !== undefined) {
          let data35 = data33.suggestionId;
          if (typeof data35 === 'string') {
            if (!formats10.test(data35)) {
              const err91 = {
                instancePath: instancePath + '/source/suggestionId',
                schemaPath: '#/$defs/ItemSource/properties/suggestionId/format',
                keyword: 'format',
                params: { format: 'uuid' },
                message: 'must match format "' + 'uuid' + '"',
              };
              if (vErrors === null) {
                vErrors = [err91];
              } else {
                vErrors.push(err91);
              }
              errors++;
            }
          } else {
            const err92 = {
              instancePath: instancePath + '/source/suggestionId',
              schemaPath: '#/$defs/ItemSource/properties/suggestionId/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err92];
            } else {
              vErrors.push(err92);
            }
            errors++;
          }
        }
        if (data33.verificationResultId !== undefined) {
          let data36 = data33.verificationResultId;
          if (typeof data36 === 'string') {
            if (!formats10.test(data36)) {
              const err93 = {
                instancePath: instancePath + '/source/verificationResultId',
                schemaPath: '#/$defs/ItemSource/properties/verificationResultId/format',
                keyword: 'format',
                params: { format: 'uuid' },
                message: 'must match format "' + 'uuid' + '"',
              };
              if (vErrors === null) {
                vErrors = [err93];
              } else {
                vErrors.push(err93);
              }
              errors++;
            }
          } else {
            const err94 = {
              instancePath: instancePath + '/source/verificationResultId',
              schemaPath: '#/$defs/ItemSource/properties/verificationResultId/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err94];
            } else {
              vErrors.push(err94);
            }
            errors++;
          }
        }
        if (data33.aiJobId !== undefined) {
          let data37 = data33.aiJobId;
          if (typeof data37 === 'string') {
            if (!formats10.test(data37)) {
              const err95 = {
                instancePath: instancePath + '/source/aiJobId',
                schemaPath: '#/$defs/ItemSource/properties/aiJobId/format',
                keyword: 'format',
                params: { format: 'uuid' },
                message: 'must match format "' + 'uuid' + '"',
              };
              if (vErrors === null) {
                vErrors = [err95];
              } else {
                vErrors.push(err95);
              }
              errors++;
            }
          } else {
            const err96 = {
              instancePath: instancePath + '/source/aiJobId',
              schemaPath: '#/$defs/ItemSource/properties/aiJobId/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err96];
            } else {
              vErrors.push(err96);
            }
            errors++;
          }
        }
        if (data33.at !== undefined) {
          let data38 = data33.at;
          if (typeof data38 === 'string') {
            if (!formats32.validate(data38)) {
              const err97 = {
                instancePath: instancePath + '/source/at',
                schemaPath: '#/$defs/ItemSource/properties/at/format',
                keyword: 'format',
                params: { format: 'date-time' },
                message: 'must match format "' + 'date-time' + '"',
              };
              if (vErrors === null) {
                vErrors = [err97];
              } else {
                vErrors.push(err97);
              }
              errors++;
            }
          } else {
            const err98 = {
              instancePath: instancePath + '/source/at',
              schemaPath: '#/$defs/ItemSource/properties/at/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err98];
            } else {
              vErrors.push(err98);
            }
            errors++;
          }
        }
      } else {
        const err99 = {
          instancePath: instancePath + '/source',
          schemaPath: '#/$defs/ItemSource/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err99];
        } else {
          vErrors.push(err99);
        }
        errors++;
      }
    }
    if (data.attachments !== undefined) {
      let data39 = data.attachments;
      if (Array.isArray(data39)) {
        const len0 = data39.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data40 = data39[i0];
          if (data40 && typeof data40 == 'object' && !Array.isArray(data40)) {
            if (data40.attachmentId === undefined) {
              const err100 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'attachmentId' },
                message: "must have required property '" + 'attachmentId' + "'",
              };
              if (vErrors === null) {
                vErrors = [err100];
              } else {
                vErrors.push(err100);
              }
              errors++;
            }
            if (data40.uploadId === undefined) {
              const err101 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'uploadId' },
                message: "must have required property '" + 'uploadId' + "'",
              };
              if (vErrors === null) {
                vErrors = [err101];
              } else {
                vErrors.push(err101);
              }
              errors++;
            }
            if (data40.fileName === undefined) {
              const err102 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'fileName' },
                message: "must have required property '" + 'fileName' + "'",
              };
              if (vErrors === null) {
                vErrors = [err102];
              } else {
                vErrors.push(err102);
              }
              errors++;
            }
            if (data40.sha256 === undefined) {
              const err103 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'sha256' },
                message: "must have required property '" + 'sha256' + "'",
              };
              if (vErrors === null) {
                vErrors = [err103];
              } else {
                vErrors.push(err103);
              }
              errors++;
            }
            for (const key8 in data40) {
              if (!(
                key8 === 'attachmentId' ||
                key8 === 'uploadId' ||
                key8 === 'fileName' ||
                key8 === 'sha256'
              )) {
                const err104 = {
                  instancePath: instancePath + '/attachments/' + i0,
                  schemaPath: '#/$defs/Attachment/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key8 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err104];
                } else {
                  vErrors.push(err104);
                }
                errors++;
              }
            }
            if (data40.attachmentId !== undefined) {
              let data41 = data40.attachmentId;
              if (typeof data41 === 'string') {
                if (!formats10.test(data41)) {
                  const err105 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/attachmentId',
                    schemaPath: '#/$defs/Attachment/properties/attachmentId/format',
                    keyword: 'format',
                    params: { format: 'uuid' },
                    message: 'must match format "' + 'uuid' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err105];
                  } else {
                    vErrors.push(err105);
                  }
                  errors++;
                }
              } else {
                const err106 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/attachmentId',
                  schemaPath: '#/$defs/Attachment/properties/attachmentId/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err106];
                } else {
                  vErrors.push(err106);
                }
                errors++;
              }
            }
            if (data40.uploadId !== undefined) {
              let data42 = data40.uploadId;
              if (typeof data42 === 'string') {
                if (!formats10.test(data42)) {
                  const err107 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/uploadId',
                    schemaPath: '#/$defs/Attachment/properties/uploadId/format',
                    keyword: 'format',
                    params: { format: 'uuid' },
                    message: 'must match format "' + 'uuid' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err107];
                  } else {
                    vErrors.push(err107);
                  }
                  errors++;
                }
              } else {
                const err108 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/uploadId',
                  schemaPath: '#/$defs/Attachment/properties/uploadId/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err108];
                } else {
                  vErrors.push(err108);
                }
                errors++;
              }
            }
            if (data40.fileName !== undefined) {
              let data43 = data40.fileName;
              if (typeof data43 === 'string') {
                if (func2(data43) > 255) {
                  const err109 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/fileName',
                    schemaPath: '#/$defs/Attachment/properties/fileName/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 255 },
                    message: 'must NOT have more than 255 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err109];
                  } else {
                    vErrors.push(err109);
                  }
                  errors++;
                }
              } else {
                const err110 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/fileName',
                  schemaPath: '#/$defs/Attachment/properties/fileName/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err110];
                } else {
                  vErrors.push(err110);
                }
                errors++;
              }
            }
            if (data40.sha256 !== undefined) {
              let data44 = data40.sha256;
              if (typeof data44 === 'string') {
                if (!pattern12.test(data44)) {
                  const err111 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/sha256',
                    schemaPath: '#/$defs/Attachment/properties/sha256/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^[0-9a-f]{64}$' },
                    message: 'must match pattern "' + '^[0-9a-f]{64}$' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err111];
                  } else {
                    vErrors.push(err111);
                  }
                  errors++;
                }
              } else {
                const err112 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/sha256',
                  schemaPath: '#/$defs/Attachment/properties/sha256/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err112];
                } else {
                  vErrors.push(err112);
                }
                errors++;
              }
            }
          } else {
            const err113 = {
              instancePath: instancePath + '/attachments/' + i0,
              schemaPath: '#/$defs/Attachment/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err113];
            } else {
              vErrors.push(err113);
            }
            errors++;
          }
        }
      } else {
        const err114 = {
          instancePath: instancePath + '/attachments',
          schemaPath: '#/properties/attachments/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err114];
        } else {
          vErrors.push(err114);
        }
        errors++;
      }
    }
  } else {
    const err115 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err115];
    } else {
      vErrors.push(err115);
    }
    errors++;
  }
  validate28.errors = vErrors;
  return errors === 0;
}
validate28.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema53 = {
  type: 'object',
  required: ['id', 'type', 'description', 'creditor', 'outstanding', 'location', 'change'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['mortgage', 'loan', 'guarantee', 'other'] },
    description: { type: 'string', minLength: 1, maxLength: 200 },
    creditor: { type: 'string', minLength: 1, maxLength: 200 },
    outstanding: { $ref: '#/$defs/Money' },
    location: { $ref: '#/$defs/Location' },
    change: { $ref: '#/$defs/ChangeFlag' },
    source: { $ref: '#/$defs/ItemSource' },
    attachments: { type: 'array', items: { $ref: '#/$defs/Attachment' } },
  },
};
function validate30(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate30.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.id === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'id' },
        message: "must have required property '" + 'id' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'type' },
        message: "must have required property '" + 'type' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.description === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'description' },
        message: "must have required property '" + 'description' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.creditor === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'creditor' },
        message: "must have required property '" + 'creditor' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.outstanding === undefined) {
      const err4 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'outstanding' },
        message: "must have required property '" + 'outstanding' + "'",
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.location === undefined) {
      const err5 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'location' },
        message: "must have required property '" + 'location' + "'",
      };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.change === undefined) {
      const err6 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'change' },
        message: "must have required property '" + 'change' + "'",
      };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema53.properties, key0)) {
        const err7 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== undefined) {
      let data0 = data.id;
      if (typeof data0 === 'string') {
        if (!formats10.test(data0)) {
          const err8 = {
            instancePath: instancePath + '/id',
            schemaPath: '#/properties/id/format',
            keyword: 'format',
            params: { format: 'uuid' },
            message: 'must match format "' + 'uuid' + '"',
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = {
          instancePath: instancePath + '/id',
          schemaPath: '#/properties/id/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.type !== undefined) {
      let data1 = data.type;
      if (typeof data1 !== 'string') {
        const err10 = {
          instancePath: instancePath + '/type',
          schemaPath: '#/properties/type/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
      if (!(
        data1 === 'mortgage' ||
        data1 === 'loan' ||
        data1 === 'guarantee' ||
        data1 === 'other'
      )) {
        const err11 = {
          instancePath: instancePath + '/type',
          schemaPath: '#/properties/type/enum',
          keyword: 'enum',
          params: { allowedValues: schema53.properties.type.enum },
          message: 'must be equal to one of the allowed values',
        };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.description !== undefined) {
      let data2 = data.description;
      if (typeof data2 === 'string') {
        if (func2(data2) > 200) {
          const err12 = {
            instancePath: instancePath + '/description',
            schemaPath: '#/properties/description/maxLength',
            keyword: 'maxLength',
            params: { limit: 200 },
            message: 'must NOT have more than 200 characters',
          };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (func2(data2) < 1) {
          const err13 = {
            instancePath: instancePath + '/description',
            schemaPath: '#/properties/description/minLength',
            keyword: 'minLength',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 characters',
          };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = {
          instancePath: instancePath + '/description',
          schemaPath: '#/properties/description/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.creditor !== undefined) {
      let data3 = data.creditor;
      if (typeof data3 === 'string') {
        if (func2(data3) > 200) {
          const err15 = {
            instancePath: instancePath + '/creditor',
            schemaPath: '#/properties/creditor/maxLength',
            keyword: 'maxLength',
            params: { limit: 200 },
            message: 'must NOT have more than 200 characters',
          };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (func2(data3) < 1) {
          const err16 = {
            instancePath: instancePath + '/creditor',
            schemaPath: '#/properties/creditor/minLength',
            keyword: 'minLength',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 characters',
          };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = {
          instancePath: instancePath + '/creditor',
          schemaPath: '#/properties/creditor/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.outstanding !== undefined) {
      let data4 = data.outstanding;
      if (data4 && typeof data4 == 'object' && !Array.isArray(data4)) {
        if (data4.kesCents === undefined) {
          const err18 = {
            instancePath: instancePath + '/outstanding',
            schemaPath: '#/$defs/Money/required',
            keyword: 'required',
            params: { missingProperty: 'kesCents' },
            message: "must have required property '" + 'kesCents' + "'",
          };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        for (const key1 in data4) {
          if (!(key1 === 'kesCents' || key1 === 'original')) {
            const err19 = {
              instancePath: instancePath + '/outstanding',
              schemaPath: '#/$defs/Money/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err19];
            } else {
              vErrors.push(err19);
            }
            errors++;
          }
        }
        if (data4.kesCents !== undefined) {
          let data5 = data4.kesCents;
          if (!(typeof data5 == 'number' && !(data5 % 1) && !isNaN(data5) && isFinite(data5))) {
            const err20 = {
              instancePath: instancePath + '/outstanding/kesCents',
              schemaPath: '#/$defs/Money/properties/kesCents/type',
              keyword: 'type',
              params: { type: 'integer' },
              message: 'must be integer',
            };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
          if (typeof data5 == 'number' && isFinite(data5)) {
            if (data5 < 0 || isNaN(data5)) {
              const err21 = {
                instancePath: instancePath + '/outstanding/kesCents',
                schemaPath: '#/$defs/Money/properties/kesCents/minimum',
                keyword: 'minimum',
                params: { comparison: '>=', limit: 0 },
                message: 'must be >= 0',
              };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          }
        }
        if (data4.original !== undefined) {
          let data6 = data4.original;
          if (data6 && typeof data6 == 'object' && !Array.isArray(data6)) {
            if (data6.currency === undefined) {
              const err22 = {
                instancePath: instancePath + '/outstanding/original',
                schemaPath: '#/$defs/Money/properties/original/required',
                keyword: 'required',
                params: { missingProperty: 'currency' },
                message: "must have required property '" + 'currency' + "'",
              };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
            if (data6.minorUnits === undefined) {
              const err23 = {
                instancePath: instancePath + '/outstanding/original',
                schemaPath: '#/$defs/Money/properties/original/required',
                keyword: 'required',
                params: { missingProperty: 'minorUnits' },
                message: "must have required property '" + 'minorUnits' + "'",
              };
              if (vErrors === null) {
                vErrors = [err23];
              } else {
                vErrors.push(err23);
              }
              errors++;
            }
            for (const key2 in data6) {
              if (!(key2 === 'currency' || key2 === 'minorUnits')) {
                const err24 = {
                  instancePath: instancePath + '/outstanding/original',
                  schemaPath: '#/$defs/Money/properties/original/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key2 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err24];
                } else {
                  vErrors.push(err24);
                }
                errors++;
              }
            }
            if (data6.currency !== undefined) {
              let data7 = data6.currency;
              if (typeof data7 === 'string') {
                if (!pattern9.test(data7)) {
                  const err25 = {
                    instancePath: instancePath + '/outstanding/original/currency',
                    schemaPath: '#/$defs/Money/properties/original/properties/currency/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^[A-Z]{3}$' },
                    message: 'must match pattern "' + '^[A-Z]{3}$' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err25];
                  } else {
                    vErrors.push(err25);
                  }
                  errors++;
                }
              } else {
                const err26 = {
                  instancePath: instancePath + '/outstanding/original/currency',
                  schemaPath: '#/$defs/Money/properties/original/properties/currency/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err26];
                } else {
                  vErrors.push(err26);
                }
                errors++;
              }
            }
            if (data6.minorUnits !== undefined) {
              let data8 = data6.minorUnits;
              if (!(typeof data8 == 'number' && !(data8 % 1) && !isNaN(data8) && isFinite(data8))) {
                const err27 = {
                  instancePath: instancePath + '/outstanding/original/minorUnits',
                  schemaPath: '#/$defs/Money/properties/original/properties/minorUnits/type',
                  keyword: 'type',
                  params: { type: 'integer' },
                  message: 'must be integer',
                };
                if (vErrors === null) {
                  vErrors = [err27];
                } else {
                  vErrors.push(err27);
                }
                errors++;
              }
              if (typeof data8 == 'number' && isFinite(data8)) {
                if (data8 < 0 || isNaN(data8)) {
                  const err28 = {
                    instancePath: instancePath + '/outstanding/original/minorUnits',
                    schemaPath: '#/$defs/Money/properties/original/properties/minorUnits/minimum',
                    keyword: 'minimum',
                    params: { comparison: '>=', limit: 0 },
                    message: 'must be >= 0',
                  };
                  if (vErrors === null) {
                    vErrors = [err28];
                  } else {
                    vErrors.push(err28);
                  }
                  errors++;
                }
              }
            }
          } else {
            const err29 = {
              instancePath: instancePath + '/outstanding/original',
              schemaPath: '#/$defs/Money/properties/original/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err29];
            } else {
              vErrors.push(err29);
            }
            errors++;
          }
        }
      } else {
        const err30 = {
          instancePath: instancePath + '/outstanding',
          schemaPath: '#/$defs/Money/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err30];
        } else {
          vErrors.push(err30);
        }
        errors++;
      }
    }
    if (data.location !== undefined) {
      let data9 = data.location;
      if (data9 && typeof data9 == 'object' && !Array.isArray(data9)) {
        if (data9.inKenya === undefined) {
          const err31 = {
            instancePath: instancePath + '/location',
            schemaPath: '#/$defs/Location/required',
            keyword: 'required',
            params: { missingProperty: 'inKenya' },
            message: "must have required property '" + 'inKenya' + "'",
          };
          if (vErrors === null) {
            vErrors = [err31];
          } else {
            vErrors.push(err31);
          }
          errors++;
        }
        for (const key3 in data9) {
          if (!(
            key3 === 'inKenya' ||
            key3 === 'county' ||
            key3 === 'country' ||
            key3 === 'detail'
          )) {
            const err32 = {
              instancePath: instancePath + '/location',
              schemaPath: '#/$defs/Location/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key3 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
        if (data9.inKenya !== undefined) {
          if (typeof data9.inKenya !== 'boolean') {
            const err33 = {
              instancePath: instancePath + '/location/inKenya',
              schemaPath: '#/$defs/Location/properties/inKenya/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err33];
            } else {
              vErrors.push(err33);
            }
            errors++;
          }
        }
        if (data9.county !== undefined) {
          let data11 = data9.county;
          if (typeof data11 === 'string') {
            if (!pattern10.test(data11)) {
              const err34 = {
                instancePath: instancePath + '/location/county',
                schemaPath: '#/$defs/Location/properties/county/pattern',
                keyword: 'pattern',
                params: { pattern: '^0(0[1-9]|[1-3][0-9]|4[0-7])$' },
                message: 'must match pattern "' + '^0(0[1-9]|[1-3][0-9]|4[0-7])$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err34];
              } else {
                vErrors.push(err34);
              }
              errors++;
            }
          } else {
            const err35 = {
              instancePath: instancePath + '/location/county',
              schemaPath: '#/$defs/Location/properties/county/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
        if (data9.country !== undefined) {
          let data12 = data9.country;
          if (typeof data12 === 'string') {
            if (!pattern11.test(data12)) {
              const err36 = {
                instancePath: instancePath + '/location/country',
                schemaPath: '#/$defs/Location/properties/country/pattern',
                keyword: 'pattern',
                params: { pattern: '^[A-Z]{2}$' },
                message: 'must match pattern "' + '^[A-Z]{2}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err36];
              } else {
                vErrors.push(err36);
              }
              errors++;
            }
          } else {
            const err37 = {
              instancePath: instancePath + '/location/country',
              schemaPath: '#/$defs/Location/properties/country/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err37];
            } else {
              vErrors.push(err37);
            }
            errors++;
          }
        }
        if (data9.detail !== undefined) {
          let data13 = data9.detail;
          if (typeof data13 === 'string') {
            if (func2(data13) > 200) {
              const err38 = {
                instancePath: instancePath + '/location/detail',
                schemaPath: '#/$defs/Location/properties/detail/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err38];
              } else {
                vErrors.push(err38);
              }
              errors++;
            }
          } else {
            const err39 = {
              instancePath: instancePath + '/location/detail',
              schemaPath: '#/$defs/Location/properties/detail/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err39];
            } else {
              vErrors.push(err39);
            }
            errors++;
          }
        }
      } else {
        const err40 = {
          instancePath: instancePath + '/location',
          schemaPath: '#/$defs/Location/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err40];
        } else {
          vErrors.push(err40);
        }
        errors++;
      }
    }
    if (data.change !== undefined) {
      let data14 = data.change;
      const _errs38 = errors;
      let valid7 = true;
      const _errs39 = errors;
      if (data14 && typeof data14 == 'object' && !Array.isArray(data14)) {
        if (data14.changed !== undefined) {
          if (true !== data14.changed) {
            const err41 = {};
            if (vErrors === null) {
              vErrors = [err41];
            } else {
              vErrors.push(err41);
            }
            errors++;
          }
        }
      }
      var _valid0 = _errs39 === errors;
      errors = _errs38;
      if (vErrors !== null) {
        if (_errs38) {
          vErrors.length = _errs38;
        } else {
          vErrors = null;
        }
      }
      if (_valid0) {
        const _errs41 = errors;
        if (data14 && typeof data14 == 'object' && !Array.isArray(data14)) {
          if (data14.changed === undefined) {
            const err42 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/then/required',
              keyword: 'required',
              params: { missingProperty: 'changed' },
              message: "must have required property '" + 'changed' + "'",
            };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
          if (data14.kind === undefined) {
            const err43 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/then/required',
              keyword: 'required',
              params: { missingProperty: 'kind' },
              message: "must have required property '" + 'kind' + "'",
            };
            if (vErrors === null) {
              vErrors = [err43];
            } else {
              vErrors.push(err43);
            }
            errors++;
          }
          if (data14.explanation === undefined) {
            const err44 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/then/required',
              keyword: 'required',
              params: { missingProperty: 'explanation' },
              message: "must have required property '" + 'explanation' + "'",
            };
            if (vErrors === null) {
              vErrors = [err44];
            } else {
              vErrors.push(err44);
            }
            errors++;
          }
        }
        var _valid0 = _errs41 === errors;
        valid7 = _valid0;
      }
      if (!valid7) {
        const err45 = {
          instancePath: instancePath + '/change',
          schemaPath: '#/$defs/ChangeFlag/if',
          keyword: 'if',
          params: { failingKeyword: 'then' },
          message: 'must match "then" schema',
        };
        if (vErrors === null) {
          vErrors = [err45];
        } else {
          vErrors.push(err45);
        }
        errors++;
      }
      if (data14 && typeof data14 == 'object' && !Array.isArray(data14)) {
        if (data14.changed === undefined) {
          const err46 = {
            instancePath: instancePath + '/change',
            schemaPath: '#/$defs/ChangeFlag/required',
            keyword: 'required',
            params: { missingProperty: 'changed' },
            message: "must have required property '" + 'changed' + "'",
          };
          if (vErrors === null) {
            vErrors = [err46];
          } else {
            vErrors.push(err46);
          }
          errors++;
        }
        for (const key4 in data14) {
          if (!(key4 === 'changed' || key4 === 'kind' || key4 === 'explanation')) {
            const err47 = {
              instancePath: instancePath + '/change',
              schemaPath: '#/$defs/ChangeFlag/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key4 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err47];
            } else {
              vErrors.push(err47);
            }
            errors++;
          }
        }
        if (data14.changed !== undefined) {
          if (typeof data14.changed !== 'boolean') {
            const err48 = {
              instancePath: instancePath + '/change/changed',
              schemaPath: '#/$defs/ChangeFlag/properties/changed/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err48];
            } else {
              vErrors.push(err48);
            }
            errors++;
          }
        }
        if (data14.kind !== undefined) {
          let data17 = data14.kind;
          if (typeof data17 !== 'string') {
            const err49 = {
              instancePath: instancePath + '/change/kind',
              schemaPath: '#/$defs/ChangeFlag/properties/kind/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err49];
            } else {
              vErrors.push(err49);
            }
            errors++;
          }
          if (!(
            data17 === 'value-change' ||
            data17 === 'acquisition' ||
            data17 === 'disposal' ||
            data17 === 'new-source' ||
            data17 === 'source-ended' ||
            data17 === 'settled'
          )) {
            const err50 = {
              instancePath: instancePath + '/change/kind',
              schemaPath: '#/$defs/ChangeFlag/properties/kind/enum',
              keyword: 'enum',
              params: { allowedValues: schema44.properties.kind.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err50];
            } else {
              vErrors.push(err50);
            }
            errors++;
          }
        }
        if (data14.explanation !== undefined) {
          let data18 = data14.explanation;
          if (typeof data18 === 'string') {
            if (func2(data18) > 1000) {
              const err51 = {
                instancePath: instancePath + '/change/explanation',
                schemaPath: '#/$defs/ChangeFlag/properties/explanation/maxLength',
                keyword: 'maxLength',
                params: { limit: 1000 },
                message: 'must NOT have more than 1000 characters',
              };
              if (vErrors === null) {
                vErrors = [err51];
              } else {
                vErrors.push(err51);
              }
              errors++;
            }
            if (func2(data18) < 1) {
              const err52 = {
                instancePath: instancePath + '/change/explanation',
                schemaPath: '#/$defs/ChangeFlag/properties/explanation/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err52];
              } else {
                vErrors.push(err52);
              }
              errors++;
            }
          } else {
            const err53 = {
              instancePath: instancePath + '/change/explanation',
              schemaPath: '#/$defs/ChangeFlag/properties/explanation/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err53];
            } else {
              vErrors.push(err53);
            }
            errors++;
          }
        }
      } else {
        const err54 = {
          instancePath: instancePath + '/change',
          schemaPath: '#/$defs/ChangeFlag/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err54];
        } else {
          vErrors.push(err54);
        }
        errors++;
      }
    }
    if (data.source !== undefined) {
      let data19 = data.source;
      if (data19 && typeof data19 == 'object' && !Array.isArray(data19)) {
        if (data19.kind === undefined) {
          const err55 = {
            instancePath: instancePath + '/source',
            schemaPath: '#/$defs/ItemSource/required',
            keyword: 'required',
            params: { missingProperty: 'kind' },
            message: "must have required property '" + 'kind' + "'",
          };
          if (vErrors === null) {
            vErrors = [err55];
          } else {
            vErrors.push(err55);
          }
          errors++;
        }
        if (data19.suggestionId === undefined) {
          const err56 = {
            instancePath: instancePath + '/source',
            schemaPath: '#/$defs/ItemSource/required',
            keyword: 'required',
            params: { missingProperty: 'suggestionId' },
            message: "must have required property '" + 'suggestionId' + "'",
          };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
        if (data19.at === undefined) {
          const err57 = {
            instancePath: instancePath + '/source',
            schemaPath: '#/$defs/ItemSource/required',
            keyword: 'required',
            params: { missingProperty: 'at' },
            message: "must have required property '" + 'at' + "'",
          };
          if (vErrors === null) {
            vErrors = [err57];
          } else {
            vErrors.push(err57);
          }
          errors++;
        }
        for (const key5 in data19) {
          if (!(
            key5 === 'kind' ||
            key5 === 'suggestionId' ||
            key5 === 'verificationResultId' ||
            key5 === 'aiJobId' ||
            key5 === 'at'
          )) {
            const err58 = {
              instancePath: instancePath + '/source',
              schemaPath: '#/$defs/ItemSource/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key5 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err58];
            } else {
              vErrors.push(err58);
            }
            errors++;
          }
        }
        if (data19.kind !== undefined) {
          let data20 = data19.kind;
          if (typeof data20 !== 'string') {
            const err59 = {
              instancePath: instancePath + '/source/kind',
              schemaPath: '#/$defs/ItemSource/properties/kind/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err59];
            } else {
              vErrors.push(err59);
            }
            errors++;
          }
          if (!(
            data20 === 'kra' ||
            data20 === 'ntsa' ||
            data20 === 'brs' ||
            data20 === 'ardhisasa' ||
            data20 === 'document'
          )) {
            const err60 = {
              instancePath: instancePath + '/source/kind',
              schemaPath: '#/$defs/ItemSource/properties/kind/enum',
              keyword: 'enum',
              params: { allowedValues: schema45.properties.kind.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err60];
            } else {
              vErrors.push(err60);
            }
            errors++;
          }
        }
        if (data19.suggestionId !== undefined) {
          let data21 = data19.suggestionId;
          if (typeof data21 === 'string') {
            if (!formats10.test(data21)) {
              const err61 = {
                instancePath: instancePath + '/source/suggestionId',
                schemaPath: '#/$defs/ItemSource/properties/suggestionId/format',
                keyword: 'format',
                params: { format: 'uuid' },
                message: 'must match format "' + 'uuid' + '"',
              };
              if (vErrors === null) {
                vErrors = [err61];
              } else {
                vErrors.push(err61);
              }
              errors++;
            }
          } else {
            const err62 = {
              instancePath: instancePath + '/source/suggestionId',
              schemaPath: '#/$defs/ItemSource/properties/suggestionId/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err62];
            } else {
              vErrors.push(err62);
            }
            errors++;
          }
        }
        if (data19.verificationResultId !== undefined) {
          let data22 = data19.verificationResultId;
          if (typeof data22 === 'string') {
            if (!formats10.test(data22)) {
              const err63 = {
                instancePath: instancePath + '/source/verificationResultId',
                schemaPath: '#/$defs/ItemSource/properties/verificationResultId/format',
                keyword: 'format',
                params: { format: 'uuid' },
                message: 'must match format "' + 'uuid' + '"',
              };
              if (vErrors === null) {
                vErrors = [err63];
              } else {
                vErrors.push(err63);
              }
              errors++;
            }
          } else {
            const err64 = {
              instancePath: instancePath + '/source/verificationResultId',
              schemaPath: '#/$defs/ItemSource/properties/verificationResultId/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err64];
            } else {
              vErrors.push(err64);
            }
            errors++;
          }
        }
        if (data19.aiJobId !== undefined) {
          let data23 = data19.aiJobId;
          if (typeof data23 === 'string') {
            if (!formats10.test(data23)) {
              const err65 = {
                instancePath: instancePath + '/source/aiJobId',
                schemaPath: '#/$defs/ItemSource/properties/aiJobId/format',
                keyword: 'format',
                params: { format: 'uuid' },
                message: 'must match format "' + 'uuid' + '"',
              };
              if (vErrors === null) {
                vErrors = [err65];
              } else {
                vErrors.push(err65);
              }
              errors++;
            }
          } else {
            const err66 = {
              instancePath: instancePath + '/source/aiJobId',
              schemaPath: '#/$defs/ItemSource/properties/aiJobId/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err66];
            } else {
              vErrors.push(err66);
            }
            errors++;
          }
        }
        if (data19.at !== undefined) {
          let data24 = data19.at;
          if (typeof data24 === 'string') {
            if (!formats32.validate(data24)) {
              const err67 = {
                instancePath: instancePath + '/source/at',
                schemaPath: '#/$defs/ItemSource/properties/at/format',
                keyword: 'format',
                params: { format: 'date-time' },
                message: 'must match format "' + 'date-time' + '"',
              };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
          } else {
            const err68 = {
              instancePath: instancePath + '/source/at',
              schemaPath: '#/$defs/ItemSource/properties/at/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err68];
            } else {
              vErrors.push(err68);
            }
            errors++;
          }
        }
      } else {
        const err69 = {
          instancePath: instancePath + '/source',
          schemaPath: '#/$defs/ItemSource/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err69];
        } else {
          vErrors.push(err69);
        }
        errors++;
      }
    }
    if (data.attachments !== undefined) {
      let data25 = data.attachments;
      if (Array.isArray(data25)) {
        const len0 = data25.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data26 = data25[i0];
          if (data26 && typeof data26 == 'object' && !Array.isArray(data26)) {
            if (data26.attachmentId === undefined) {
              const err70 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'attachmentId' },
                message: "must have required property '" + 'attachmentId' + "'",
              };
              if (vErrors === null) {
                vErrors = [err70];
              } else {
                vErrors.push(err70);
              }
              errors++;
            }
            if (data26.uploadId === undefined) {
              const err71 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'uploadId' },
                message: "must have required property '" + 'uploadId' + "'",
              };
              if (vErrors === null) {
                vErrors = [err71];
              } else {
                vErrors.push(err71);
              }
              errors++;
            }
            if (data26.fileName === undefined) {
              const err72 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'fileName' },
                message: "must have required property '" + 'fileName' + "'",
              };
              if (vErrors === null) {
                vErrors = [err72];
              } else {
                vErrors.push(err72);
              }
              errors++;
            }
            if (data26.sha256 === undefined) {
              const err73 = {
                instancePath: instancePath + '/attachments/' + i0,
                schemaPath: '#/$defs/Attachment/required',
                keyword: 'required',
                params: { missingProperty: 'sha256' },
                message: "must have required property '" + 'sha256' + "'",
              };
              if (vErrors === null) {
                vErrors = [err73];
              } else {
                vErrors.push(err73);
              }
              errors++;
            }
            for (const key6 in data26) {
              if (!(
                key6 === 'attachmentId' ||
                key6 === 'uploadId' ||
                key6 === 'fileName' ||
                key6 === 'sha256'
              )) {
                const err74 = {
                  instancePath: instancePath + '/attachments/' + i0,
                  schemaPath: '#/$defs/Attachment/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key6 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err74];
                } else {
                  vErrors.push(err74);
                }
                errors++;
              }
            }
            if (data26.attachmentId !== undefined) {
              let data27 = data26.attachmentId;
              if (typeof data27 === 'string') {
                if (!formats10.test(data27)) {
                  const err75 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/attachmentId',
                    schemaPath: '#/$defs/Attachment/properties/attachmentId/format',
                    keyword: 'format',
                    params: { format: 'uuid' },
                    message: 'must match format "' + 'uuid' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err75];
                  } else {
                    vErrors.push(err75);
                  }
                  errors++;
                }
              } else {
                const err76 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/attachmentId',
                  schemaPath: '#/$defs/Attachment/properties/attachmentId/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err76];
                } else {
                  vErrors.push(err76);
                }
                errors++;
              }
            }
            if (data26.uploadId !== undefined) {
              let data28 = data26.uploadId;
              if (typeof data28 === 'string') {
                if (!formats10.test(data28)) {
                  const err77 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/uploadId',
                    schemaPath: '#/$defs/Attachment/properties/uploadId/format',
                    keyword: 'format',
                    params: { format: 'uuid' },
                    message: 'must match format "' + 'uuid' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err77];
                  } else {
                    vErrors.push(err77);
                  }
                  errors++;
                }
              } else {
                const err78 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/uploadId',
                  schemaPath: '#/$defs/Attachment/properties/uploadId/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err78];
                } else {
                  vErrors.push(err78);
                }
                errors++;
              }
            }
            if (data26.fileName !== undefined) {
              let data29 = data26.fileName;
              if (typeof data29 === 'string') {
                if (func2(data29) > 255) {
                  const err79 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/fileName',
                    schemaPath: '#/$defs/Attachment/properties/fileName/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 255 },
                    message: 'must NOT have more than 255 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err79];
                  } else {
                    vErrors.push(err79);
                  }
                  errors++;
                }
              } else {
                const err80 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/fileName',
                  schemaPath: '#/$defs/Attachment/properties/fileName/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err80];
                } else {
                  vErrors.push(err80);
                }
                errors++;
              }
            }
            if (data26.sha256 !== undefined) {
              let data30 = data26.sha256;
              if (typeof data30 === 'string') {
                if (!pattern12.test(data30)) {
                  const err81 = {
                    instancePath: instancePath + '/attachments/' + i0 + '/sha256',
                    schemaPath: '#/$defs/Attachment/properties/sha256/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^[0-9a-f]{64}$' },
                    message: 'must match pattern "' + '^[0-9a-f]{64}$' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err81];
                  } else {
                    vErrors.push(err81);
                  }
                  errors++;
                }
              } else {
                const err82 = {
                  instancePath: instancePath + '/attachments/' + i0 + '/sha256',
                  schemaPath: '#/$defs/Attachment/properties/sha256/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err82];
                } else {
                  vErrors.push(err82);
                }
                errors++;
              }
            }
          } else {
            const err83 = {
              instancePath: instancePath + '/attachments/' + i0,
              schemaPath: '#/$defs/Attachment/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err83];
            } else {
              vErrors.push(err83);
            }
            errors++;
          }
        }
      } else {
        const err84 = {
          instancePath: instancePath + '/attachments',
          schemaPath: '#/properties/attachments/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err84];
        } else {
          vErrors.push(err84);
        }
        errors++;
      }
    }
  } else {
    const err85 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err85];
    } else {
      vErrors.push(err85);
    }
    errors++;
  }
  validate30.errors = vErrors;
  return errors === 0;
}
validate30.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate25(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate25.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.incomeNil !== undefined) {
      if (true !== data.incomeNil) {
        const err0 = {};
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  let ifClause0;
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.income !== undefined) {
        let data1 = data.income;
        if (Array.isArray(data1)) {
          if (data1.length > 0) {
            const err1 = {
              instancePath: instancePath + '/income',
              schemaPath: '#/allOf/0/then/properties/income/maxItems',
              keyword: 'maxItems',
              params: { limit: 0 },
              message: 'must NOT have more than 0 items',
            };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
    if (valid1) {
      var props0 = {};
      props0.income = true;
      props0.incomeNil = true;
    }
    ifClause0 = 'then';
  } else {
    const _errs7 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.income !== undefined) {
        let data2 = data.income;
        if (Array.isArray(data2)) {
          if (data2.length < 1) {
            const err2 = {
              instancePath: instancePath + '/income',
              schemaPath: '#/allOf/0/else/properties/income/minItems',
              keyword: 'minItems',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 items',
            };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs7 === errors;
    valid1 = _valid0;
    if (valid1) {
      if (props0 !== true) {
        props0 = props0 || {};
        props0.income = true;
      }
    }
    ifClause0 = 'else';
  }
  if (!valid1) {
    const err3 = {
      instancePath,
      schemaPath: '#/allOf/0/if',
      keyword: 'if',
      params: { failingKeyword: ifClause0 },
      message: 'must match "' + ifClause0 + '" schema',
    };
    if (vErrors === null) {
      vErrors = [err3];
    } else {
      vErrors.push(err3);
    }
    errors++;
  }
  const _errs10 = errors;
  let valid5 = true;
  const _errs11 = errors;
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.assetsNil !== undefined) {
      if (true !== data.assetsNil) {
        const err4 = {};
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
  }
  var _valid1 = _errs11 === errors;
  errors = _errs10;
  if (vErrors !== null) {
    if (_errs10) {
      vErrors.length = _errs10;
    } else {
      vErrors = null;
    }
  }
  let ifClause1;
  if (_valid1) {
    const _errs13 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.assets !== undefined) {
        let data4 = data.assets;
        if (Array.isArray(data4)) {
          if (data4.length > 0) {
            const err5 = {
              instancePath: instancePath + '/assets',
              schemaPath: '#/allOf/1/then/properties/assets/maxItems',
              keyword: 'maxItems',
              params: { limit: 0 },
              message: 'must NOT have more than 0 items',
            };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        }
      }
    }
    var _valid1 = _errs13 === errors;
    valid5 = _valid1;
    if (valid5) {
      var props1 = {};
      props1.assets = true;
      props1.assetsNil = true;
    }
    ifClause1 = 'then';
  } else {
    const _errs15 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.assets !== undefined) {
        let data5 = data.assets;
        if (Array.isArray(data5)) {
          if (data5.length < 1) {
            const err6 = {
              instancePath: instancePath + '/assets',
              schemaPath: '#/allOf/1/else/properties/assets/minItems',
              keyword: 'minItems',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 items',
            };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
      }
    }
    var _valid1 = _errs15 === errors;
    valid5 = _valid1;
    if (valid5) {
      if (props1 !== true) {
        props1 = props1 || {};
        props1.assets = true;
      }
    }
    ifClause1 = 'else';
  }
  if (!valid5) {
    const err7 = {
      instancePath,
      schemaPath: '#/allOf/1/if',
      keyword: 'if',
      params: { failingKeyword: ifClause1 },
      message: 'must match "' + ifClause1 + '" schema',
    };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  if (props0 !== true && props1 !== undefined) {
    if (props1 === true) {
      props0 = true;
    } else {
      props0 = props0 || {};
      Object.assign(props0, props1);
    }
  }
  const _errs18 = errors;
  let valid9 = true;
  const _errs19 = errors;
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.liabilitiesNil !== undefined) {
      if (true !== data.liabilitiesNil) {
        const err8 = {};
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
  }
  var _valid2 = _errs19 === errors;
  errors = _errs18;
  if (vErrors !== null) {
    if (_errs18) {
      vErrors.length = _errs18;
    } else {
      vErrors = null;
    }
  }
  let ifClause2;
  if (_valid2) {
    const _errs21 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.liabilities !== undefined) {
        let data7 = data.liabilities;
        if (Array.isArray(data7)) {
          if (data7.length > 0) {
            const err9 = {
              instancePath: instancePath + '/liabilities',
              schemaPath: '#/allOf/2/then/properties/liabilities/maxItems',
              keyword: 'maxItems',
              params: { limit: 0 },
              message: 'must NOT have more than 0 items',
            };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
      }
    }
    var _valid2 = _errs21 === errors;
    valid9 = _valid2;
    if (valid9) {
      var props2 = {};
      props2.liabilities = true;
      props2.liabilitiesNil = true;
    }
    ifClause2 = 'then';
  } else {
    const _errs23 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.liabilities !== undefined) {
        let data8 = data.liabilities;
        if (Array.isArray(data8)) {
          if (data8.length < 1) {
            const err10 = {
              instancePath: instancePath + '/liabilities',
              schemaPath: '#/allOf/2/else/properties/liabilities/minItems',
              keyword: 'minItems',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 items',
            };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
        }
      }
    }
    var _valid2 = _errs23 === errors;
    valid9 = _valid2;
    if (valid9) {
      if (props2 !== true) {
        props2 = props2 || {};
        props2.liabilities = true;
      }
    }
    ifClause2 = 'else';
  }
  if (!valid9) {
    const err11 = {
      instancePath,
      schemaPath: '#/allOf/2/if',
      keyword: 'if',
      params: { failingKeyword: ifClause2 },
      message: 'must match "' + ifClause2 + '" schema',
    };
    if (vErrors === null) {
      vErrors = [err11];
    } else {
      vErrors.push(err11);
    }
    errors++;
  }
  if (props0 !== true && props2 !== undefined) {
    if (props2 === true) {
      props0 = true;
    } else {
      props0 = props0 || {};
      Object.assign(props0, props2);
    }
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.personKey === undefined) {
      const err12 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'personKey' },
        message: "must have required property '" + 'personKey' + "'",
      };
      if (vErrors === null) {
        vErrors = [err12];
      } else {
        vErrors.push(err12);
      }
      errors++;
    }
    if (data.personName === undefined) {
      const err13 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'personName' },
        message: "must have required property '" + 'personName' + "'",
      };
      if (vErrors === null) {
        vErrors = [err13];
      } else {
        vErrors.push(err13);
      }
      errors++;
    }
    if (data.statementDate === undefined) {
      const err14 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'statementDate' },
        message: "must have required property '" + 'statementDate' + "'",
      };
      if (vErrors === null) {
        vErrors = [err14];
      } else {
        vErrors.push(err14);
      }
      errors++;
    }
    if (data.incomePeriod === undefined) {
      const err15 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'incomePeriod' },
        message: "must have required property '" + 'incomePeriod' + "'",
      };
      if (vErrors === null) {
        vErrors = [err15];
      } else {
        vErrors.push(err15);
      }
      errors++;
    }
    if (data.incomeNil === undefined) {
      const err16 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'incomeNil' },
        message: "must have required property '" + 'incomeNil' + "'",
      };
      if (vErrors === null) {
        vErrors = [err16];
      } else {
        vErrors.push(err16);
      }
      errors++;
    }
    if (data.income === undefined) {
      const err17 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'income' },
        message: "must have required property '" + 'income' + "'",
      };
      if (vErrors === null) {
        vErrors = [err17];
      } else {
        vErrors.push(err17);
      }
      errors++;
    }
    if (data.assetsNil === undefined) {
      const err18 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'assetsNil' },
        message: "must have required property '" + 'assetsNil' + "'",
      };
      if (vErrors === null) {
        vErrors = [err18];
      } else {
        vErrors.push(err18);
      }
      errors++;
    }
    if (data.assets === undefined) {
      const err19 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'assets' },
        message: "must have required property '" + 'assets' + "'",
      };
      if (vErrors === null) {
        vErrors = [err19];
      } else {
        vErrors.push(err19);
      }
      errors++;
    }
    if (data.liabilitiesNil === undefined) {
      const err20 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'liabilitiesNil' },
        message: "must have required property '" + 'liabilitiesNil' + "'",
      };
      if (vErrors === null) {
        vErrors = [err20];
      } else {
        vErrors.push(err20);
      }
      errors++;
    }
    if (data.liabilities === undefined) {
      const err21 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'liabilities' },
        message: "must have required property '" + 'liabilities' + "'",
      };
      if (vErrors === null) {
        vErrors = [err21];
      } else {
        vErrors.push(err21);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema38.properties, key0)) {
        const err22 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.personKey !== undefined) {
      let data9 = data.personKey;
      if (typeof data9 === 'string') {
        if (!pattern8.test(data9)) {
          const err23 = {
            instancePath: instancePath + '/personKey',
            schemaPath: '#/$defs/PersonKey/pattern',
            keyword: 'pattern',
            params: { pattern: '^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$' },
            message:
              'must match pattern "' + '^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$' + '"',
          };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        }
      } else {
        const err24 = {
          instancePath: instancePath + '/personKey',
          schemaPath: '#/$defs/PersonKey/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.personName !== undefined) {
      let data10 = data.personName;
      if (data10 && typeof data10 == 'object' && !Array.isArray(data10)) {
        if (data10.surname === undefined) {
          const err25 = {
            instancePath: instancePath + '/personName',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'surname' },
            message: "must have required property '" + 'surname' + "'",
          };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
        if (data10.firstName === undefined) {
          const err26 = {
            instancePath: instancePath + '/personName',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'firstName' },
            message: "must have required property '" + 'firstName' + "'",
          };
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
        for (const key1 in data10) {
          if (!(key1 === 'surname' || key1 === 'firstName' || key1 === 'otherNames')) {
            const err27 = {
              instancePath: instancePath + '/personName',
              schemaPath: '#/$defs/PersonName/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err27];
            } else {
              vErrors.push(err27);
            }
            errors++;
          }
        }
        if (data10.surname !== undefined) {
          let data11 = data10.surname;
          if (typeof data11 === 'string') {
            if (func2(data11) > 100) {
              const err28 = {
                instancePath: instancePath + '/personName/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err28];
              } else {
                vErrors.push(err28);
              }
              errors++;
            }
            if (func2(data11) < 1) {
              const err29 = {
                instancePath: instancePath + '/personName/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err29];
              } else {
                vErrors.push(err29);
              }
              errors++;
            }
          } else {
            const err30 = {
              instancePath: instancePath + '/personName/surname',
              schemaPath: '#/$defs/PersonName/properties/surname/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err30];
            } else {
              vErrors.push(err30);
            }
            errors++;
          }
        }
        if (data10.firstName !== undefined) {
          let data12 = data10.firstName;
          if (typeof data12 === 'string') {
            if (func2(data12) > 100) {
              const err31 = {
                instancePath: instancePath + '/personName/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
            if (func2(data12) < 1) {
              const err32 = {
                instancePath: instancePath + '/personName/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err32];
              } else {
                vErrors.push(err32);
              }
              errors++;
            }
          } else {
            const err33 = {
              instancePath: instancePath + '/personName/firstName',
              schemaPath: '#/$defs/PersonName/properties/firstName/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err33];
            } else {
              vErrors.push(err33);
            }
            errors++;
          }
        }
        if (data10.otherNames !== undefined) {
          let data13 = data10.otherNames;
          if (typeof data13 === 'string') {
            if (func2(data13) > 200) {
              const err34 = {
                instancePath: instancePath + '/personName/otherNames',
                schemaPath: '#/$defs/PersonName/properties/otherNames/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err34];
              } else {
                vErrors.push(err34);
              }
              errors++;
            }
          } else {
            const err35 = {
              instancePath: instancePath + '/personName/otherNames',
              schemaPath: '#/$defs/PersonName/properties/otherNames/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
      } else {
        const err36 = {
          instancePath: instancePath + '/personName',
          schemaPath: '#/$defs/PersonName/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
    }
    if (data.statementDate !== undefined) {
      let data14 = data.statementDate;
      if (typeof data14 === 'string') {
        if (!formats0.validate(data14)) {
          const err37 = {
            instancePath: instancePath + '/statementDate',
            schemaPath: '#/properties/statementDate/format',
            keyword: 'format',
            params: { format: 'date' },
            message: 'must match format "' + 'date' + '"',
          };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
      } else {
        const err38 = {
          instancePath: instancePath + '/statementDate',
          schemaPath: '#/properties/statementDate/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err38];
        } else {
          vErrors.push(err38);
        }
        errors++;
      }
    }
    if (data.incomePeriod !== undefined) {
      let data15 = data.incomePeriod;
      if (data15 && typeof data15 == 'object' && !Array.isArray(data15)) {
        if (data15.from === undefined) {
          const err39 = {
            instancePath: instancePath + '/incomePeriod',
            schemaPath: '#/properties/incomePeriod/required',
            keyword: 'required',
            params: { missingProperty: 'from' },
            message: "must have required property '" + 'from' + "'",
          };
          if (vErrors === null) {
            vErrors = [err39];
          } else {
            vErrors.push(err39);
          }
          errors++;
        }
        if (data15.to === undefined) {
          const err40 = {
            instancePath: instancePath + '/incomePeriod',
            schemaPath: '#/properties/incomePeriod/required',
            keyword: 'required',
            params: { missingProperty: 'to' },
            message: "must have required property '" + 'to' + "'",
          };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        for (const key2 in data15) {
          if (!(key2 === 'from' || key2 === 'to')) {
            const err41 = {
              instancePath: instancePath + '/incomePeriod',
              schemaPath: '#/properties/incomePeriod/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key2 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err41];
            } else {
              vErrors.push(err41);
            }
            errors++;
          }
        }
        if (data15.from !== undefined) {
          let data16 = data15.from;
          if (typeof data16 === 'string') {
            if (!formats0.validate(data16)) {
              const err42 = {
                instancePath: instancePath + '/incomePeriod/from',
                schemaPath: '#/properties/incomePeriod/properties/from/format',
                keyword: 'format',
                params: { format: 'date' },
                message: 'must match format "' + 'date' + '"',
              };
              if (vErrors === null) {
                vErrors = [err42];
              } else {
                vErrors.push(err42);
              }
              errors++;
            }
          } else {
            const err43 = {
              instancePath: instancePath + '/incomePeriod/from',
              schemaPath: '#/properties/incomePeriod/properties/from/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err43];
            } else {
              vErrors.push(err43);
            }
            errors++;
          }
        }
        if (data15.to !== undefined) {
          let data17 = data15.to;
          if (typeof data17 === 'string') {
            if (!formats0.validate(data17)) {
              const err44 = {
                instancePath: instancePath + '/incomePeriod/to',
                schemaPath: '#/properties/incomePeriod/properties/to/format',
                keyword: 'format',
                params: { format: 'date' },
                message: 'must match format "' + 'date' + '"',
              };
              if (vErrors === null) {
                vErrors = [err44];
              } else {
                vErrors.push(err44);
              }
              errors++;
            }
          } else {
            const err45 = {
              instancePath: instancePath + '/incomePeriod/to',
              schemaPath: '#/properties/incomePeriod/properties/to/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
        }
      } else {
        const err46 = {
          instancePath: instancePath + '/incomePeriod',
          schemaPath: '#/properties/incomePeriod/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err46];
        } else {
          vErrors.push(err46);
        }
        errors++;
      }
    }
    if (data.incomeNil !== undefined) {
      if (typeof data.incomeNil !== 'boolean') {
        const err47 = {
          instancePath: instancePath + '/incomeNil',
          schemaPath: '#/properties/incomeNil/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err47];
        } else {
          vErrors.push(err47);
        }
        errors++;
      }
    }
    if (data.income !== undefined) {
      let data19 = data.income;
      if (Array.isArray(data19)) {
        const len0 = data19.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (
            !validate26(data19[i0], {
              instancePath: instancePath + '/income/' + i0,
              parentData: data19,
              parentDataProperty: i0,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate26.errors : vErrors.concat(validate26.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err48 = {
          instancePath: instancePath + '/income',
          schemaPath: '#/properties/income/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err48];
        } else {
          vErrors.push(err48);
        }
        errors++;
      }
    }
    if (data.assetsNil !== undefined) {
      if (typeof data.assetsNil !== 'boolean') {
        const err49 = {
          instancePath: instancePath + '/assetsNil',
          schemaPath: '#/properties/assetsNil/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err49];
        } else {
          vErrors.push(err49);
        }
        errors++;
      }
    }
    if (data.assets !== undefined) {
      let data22 = data.assets;
      if (Array.isArray(data22)) {
        const len1 = data22.length;
        for (let i1 = 0; i1 < len1; i1++) {
          if (
            !validate28(data22[i1], {
              instancePath: instancePath + '/assets/' + i1,
              parentData: data22,
              parentDataProperty: i1,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate28.errors : vErrors.concat(validate28.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err50 = {
          instancePath: instancePath + '/assets',
          schemaPath: '#/properties/assets/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err50];
        } else {
          vErrors.push(err50);
        }
        errors++;
      }
    }
    if (data.liabilitiesNil !== undefined) {
      if (typeof data.liabilitiesNil !== 'boolean') {
        const err51 = {
          instancePath: instancePath + '/liabilitiesNil',
          schemaPath: '#/properties/liabilitiesNil/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err51];
        } else {
          vErrors.push(err51);
        }
        errors++;
      }
    }
    if (data.liabilities !== undefined) {
      let data25 = data.liabilities;
      if (Array.isArray(data25)) {
        const len2 = data25.length;
        for (let i2 = 0; i2 < len2; i2++) {
          if (
            !validate30(data25[i2], {
              instancePath: instancePath + '/liabilities/' + i2,
              parentData: data25,
              parentDataProperty: i2,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err52 = {
          instancePath: instancePath + '/liabilities',
          schemaPath: '#/properties/liabilities/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err52];
        } else {
          vErrors.push(err52);
        }
        errors++;
      }
    }
    if (data.knowledgeLimitation !== undefined) {
      let data27 = data.knowledgeLimitation;
      if (typeof data27 === 'string') {
        if (func2(data27) > 1000) {
          const err53 = {
            instancePath: instancePath + '/knowledgeLimitation',
            schemaPath: '#/properties/knowledgeLimitation/maxLength',
            keyword: 'maxLength',
            params: { limit: 1000 },
            message: 'must NOT have more than 1000 characters',
          };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
      } else {
        const err54 = {
          instancePath: instancePath + '/knowledgeLimitation',
          schemaPath: '#/properties/knowledgeLimitation/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err54];
        } else {
          vErrors.push(err54);
        }
        errors++;
      }
    }
  } else {
    const err55 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err55];
    } else {
      vErrors.push(err55);
    }
    errors++;
  }
  validate25.errors = vErrors;
  return errors === 0;
}
validate25.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema59 = {
  type: 'object',
  required: ['kind', 'explanation'],
  additionalProperties: false,
  properties: {
    personKey: { $ref: '#/$defs/PersonKey' },
    itemId: { type: 'string', format: 'uuid' },
    itemDescription: { type: 'string', maxLength: 200 },
    kind: {
      type: 'string',
      enum: [
        'value-change',
        'acquisition',
        'disposal',
        'new-source',
        'source-ended',
        'settled',
        'marital-status',
        'directorship',
        'membership',
      ],
    },
    explanation: { type: 'string', maxLength: 1000 },
  },
};
function validate33(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate33.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.kind === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'kind' },
        message: "must have required property '" + 'kind' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.explanation === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'explanation' },
        message: "must have required property '" + 'explanation' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(
        key0 === 'personKey' ||
        key0 === 'itemId' ||
        key0 === 'itemDescription' ||
        key0 === 'kind' ||
        key0 === 'explanation'
      )) {
        const err2 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.personKey !== undefined) {
      let data0 = data.personKey;
      if (typeof data0 === 'string') {
        if (!pattern8.test(data0)) {
          const err3 = {
            instancePath: instancePath + '/personKey',
            schemaPath: '#/$defs/PersonKey/pattern',
            keyword: 'pattern',
            params: { pattern: '^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$' },
            message:
              'must match pattern "' + '^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$' + '"',
          };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = {
          instancePath: instancePath + '/personKey',
          schemaPath: '#/$defs/PersonKey/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.itemId !== undefined) {
      let data1 = data.itemId;
      if (typeof data1 === 'string') {
        if (!formats10.test(data1)) {
          const err5 = {
            instancePath: instancePath + '/itemId',
            schemaPath: '#/properties/itemId/format',
            keyword: 'format',
            params: { format: 'uuid' },
            message: 'must match format "' + 'uuid' + '"',
          };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = {
          instancePath: instancePath + '/itemId',
          schemaPath: '#/properties/itemId/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.itemDescription !== undefined) {
      let data2 = data.itemDescription;
      if (typeof data2 === 'string') {
        if (func2(data2) > 200) {
          const err7 = {
            instancePath: instancePath + '/itemDescription',
            schemaPath: '#/properties/itemDescription/maxLength',
            keyword: 'maxLength',
            params: { limit: 200 },
            message: 'must NOT have more than 200 characters',
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = {
          instancePath: instancePath + '/itemDescription',
          schemaPath: '#/properties/itemDescription/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.kind !== undefined) {
      let data3 = data.kind;
      if (typeof data3 !== 'string') {
        const err9 = {
          instancePath: instancePath + '/kind',
          schemaPath: '#/properties/kind/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
      if (!(
        data3 === 'value-change' ||
        data3 === 'acquisition' ||
        data3 === 'disposal' ||
        data3 === 'new-source' ||
        data3 === 'source-ended' ||
        data3 === 'settled' ||
        data3 === 'marital-status' ||
        data3 === 'directorship' ||
        data3 === 'membership'
      )) {
        const err10 = {
          instancePath: instancePath + '/kind',
          schemaPath: '#/properties/kind/enum',
          keyword: 'enum',
          params: { allowedValues: schema59.properties.kind.enum },
          message: 'must be equal to one of the allowed values',
        };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.explanation !== undefined) {
      let data4 = data.explanation;
      if (typeof data4 === 'string') {
        if (func2(data4) > 1000) {
          const err11 = {
            instancePath: instancePath + '/explanation',
            schemaPath: '#/properties/explanation/maxLength',
            keyword: 'maxLength',
            params: { limit: 1000 },
            message: 'must NOT have more than 1000 characters',
          };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = {
          instancePath: instancePath + '/explanation',
          schemaPath: '#/properties/explanation/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
  } else {
    const err13 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err13];
    } else {
      vErrors.push(err13);
    }
    errors++;
  }
  validate33.errors = vErrors;
  return errors === 0;
}
validate33.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema61 = {
  type: 'object',
  description: 'Second Schedule vocabulary relevant to paragraph 9',
  required: ['directorships', 'memberships', 'dualCitizenship', 'pendingCases'],
  additionalProperties: false,
  properties: {
    directorships: {
      type: 'array',
      items: {
        type: 'object',
        required: ['company', 'role', 'remunerated'],
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description:
              'Set when the directorship was added from a registry suggestion (spec 05b), which `source` names',
          },
          company: { type: 'string', maxLength: 200 },
          role: { type: 'string', maxLength: 100 },
          remunerated: { type: 'boolean' },
          change: { $ref: '#/$defs/ChangeFlag' },
          source: { $ref: '#/$defs/ItemSource' },
        },
      },
    },
    memberships: {
      type: 'array',
      items: {
        type: 'object',
        required: ['entity', 'kind'],
        additionalProperties: false,
        properties: {
          entity: { type: 'string', maxLength: 200 },
          kind: {
            type: 'string',
            enum: ['company', 'partnership', 'society', 'club', 'foundation', 'trust', 'other'],
          },
          change: { $ref: '#/$defs/ChangeFlag' },
        },
      },
    },
    dualCitizenship: {
      type: 'object',
      required: ['holds', 'pendingApplication'],
      additionalProperties: false,
      properties: {
        holds: { type: 'boolean' },
        country: { type: 'string', pattern: '^[A-Z]{2}$' },
        pendingApplication: { type: 'boolean' },
      },
    },
    pendingCases: {
      type: 'array',
      items: {
        type: 'object',
        required: ['forum', 'reference', 'nature'],
        additionalProperties: false,
        properties: {
          forum: { type: 'string', maxLength: 200 },
          reference: { type: 'string', maxLength: 100 },
          nature: { type: 'string', maxLength: 500 },
        },
      },
    },
  },
};
function validate35(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate35.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.directorships === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'directorships' },
        message: "must have required property '" + 'directorships' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.memberships === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'memberships' },
        message: "must have required property '" + 'memberships' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.dualCitizenship === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'dualCitizenship' },
        message: "must have required property '" + 'dualCitizenship' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.pendingCases === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'pendingCases' },
        message: "must have required property '" + 'pendingCases' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(
        key0 === 'directorships' ||
        key0 === 'memberships' ||
        key0 === 'dualCitizenship' ||
        key0 === 'pendingCases'
      )) {
        const err4 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.directorships !== undefined) {
      let data0 = data.directorships;
      if (Array.isArray(data0)) {
        const len0 = data0.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data1 = data0[i0];
          if (data1 && typeof data1 == 'object' && !Array.isArray(data1)) {
            if (data1.company === undefined) {
              const err5 = {
                instancePath: instancePath + '/directorships/' + i0,
                schemaPath: '#/properties/directorships/items/required',
                keyword: 'required',
                params: { missingProperty: 'company' },
                message: "must have required property '" + 'company' + "'",
              };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
            if (data1.role === undefined) {
              const err6 = {
                instancePath: instancePath + '/directorships/' + i0,
                schemaPath: '#/properties/directorships/items/required',
                keyword: 'required',
                params: { missingProperty: 'role' },
                message: "must have required property '" + 'role' + "'",
              };
              if (vErrors === null) {
                vErrors = [err6];
              } else {
                vErrors.push(err6);
              }
              errors++;
            }
            if (data1.remunerated === undefined) {
              const err7 = {
                instancePath: instancePath + '/directorships/' + i0,
                schemaPath: '#/properties/directorships/items/required',
                keyword: 'required',
                params: { missingProperty: 'remunerated' },
                message: "must have required property '" + 'remunerated' + "'",
              };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
            for (const key1 in data1) {
              if (!(
                key1 === 'id' ||
                key1 === 'company' ||
                key1 === 'role' ||
                key1 === 'remunerated' ||
                key1 === 'change' ||
                key1 === 'source'
              )) {
                const err8 = {
                  instancePath: instancePath + '/directorships/' + i0,
                  schemaPath: '#/properties/directorships/items/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key1 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err8];
                } else {
                  vErrors.push(err8);
                }
                errors++;
              }
            }
            if (data1.id !== undefined) {
              let data2 = data1.id;
              if (typeof data2 === 'string') {
                if (!formats10.test(data2)) {
                  const err9 = {
                    instancePath: instancePath + '/directorships/' + i0 + '/id',
                    schemaPath: '#/properties/directorships/items/properties/id/format',
                    keyword: 'format',
                    params: { format: 'uuid' },
                    message: 'must match format "' + 'uuid' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err9];
                  } else {
                    vErrors.push(err9);
                  }
                  errors++;
                }
              } else {
                const err10 = {
                  instancePath: instancePath + '/directorships/' + i0 + '/id',
                  schemaPath: '#/properties/directorships/items/properties/id/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
              }
            }
            if (data1.company !== undefined) {
              let data3 = data1.company;
              if (typeof data3 === 'string') {
                if (func2(data3) > 200) {
                  const err11 = {
                    instancePath: instancePath + '/directorships/' + i0 + '/company',
                    schemaPath: '#/properties/directorships/items/properties/company/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 200 },
                    message: 'must NOT have more than 200 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err11];
                  } else {
                    vErrors.push(err11);
                  }
                  errors++;
                }
              } else {
                const err12 = {
                  instancePath: instancePath + '/directorships/' + i0 + '/company',
                  schemaPath: '#/properties/directorships/items/properties/company/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err12];
                } else {
                  vErrors.push(err12);
                }
                errors++;
              }
            }
            if (data1.role !== undefined) {
              let data4 = data1.role;
              if (typeof data4 === 'string') {
                if (func2(data4) > 100) {
                  const err13 = {
                    instancePath: instancePath + '/directorships/' + i0 + '/role',
                    schemaPath: '#/properties/directorships/items/properties/role/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err13];
                  } else {
                    vErrors.push(err13);
                  }
                  errors++;
                }
              } else {
                const err14 = {
                  instancePath: instancePath + '/directorships/' + i0 + '/role',
                  schemaPath: '#/properties/directorships/items/properties/role/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err14];
                } else {
                  vErrors.push(err14);
                }
                errors++;
              }
            }
            if (data1.remunerated !== undefined) {
              if (typeof data1.remunerated !== 'boolean') {
                const err15 = {
                  instancePath: instancePath + '/directorships/' + i0 + '/remunerated',
                  schemaPath: '#/properties/directorships/items/properties/remunerated/type',
                  keyword: 'type',
                  params: { type: 'boolean' },
                  message: 'must be boolean',
                };
                if (vErrors === null) {
                  vErrors = [err15];
                } else {
                  vErrors.push(err15);
                }
                errors++;
              }
            }
            if (data1.change !== undefined) {
              let data6 = data1.change;
              const _errs18 = errors;
              let valid5 = true;
              const _errs19 = errors;
              if (data6 && typeof data6 == 'object' && !Array.isArray(data6)) {
                if (data6.changed !== undefined) {
                  if (true !== data6.changed) {
                    const err16 = {};
                    if (vErrors === null) {
                      vErrors = [err16];
                    } else {
                      vErrors.push(err16);
                    }
                    errors++;
                  }
                }
              }
              var _valid0 = _errs19 === errors;
              errors = _errs18;
              if (vErrors !== null) {
                if (_errs18) {
                  vErrors.length = _errs18;
                } else {
                  vErrors = null;
                }
              }
              if (_valid0) {
                const _errs21 = errors;
                if (data6 && typeof data6 == 'object' && !Array.isArray(data6)) {
                  if (data6.changed === undefined) {
                    const err17 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/change',
                      schemaPath: '#/$defs/ChangeFlag/then/required',
                      keyword: 'required',
                      params: { missingProperty: 'changed' },
                      message: "must have required property '" + 'changed' + "'",
                    };
                    if (vErrors === null) {
                      vErrors = [err17];
                    } else {
                      vErrors.push(err17);
                    }
                    errors++;
                  }
                  if (data6.kind === undefined) {
                    const err18 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/change',
                      schemaPath: '#/$defs/ChangeFlag/then/required',
                      keyword: 'required',
                      params: { missingProperty: 'kind' },
                      message: "must have required property '" + 'kind' + "'",
                    };
                    if (vErrors === null) {
                      vErrors = [err18];
                    } else {
                      vErrors.push(err18);
                    }
                    errors++;
                  }
                  if (data6.explanation === undefined) {
                    const err19 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/change',
                      schemaPath: '#/$defs/ChangeFlag/then/required',
                      keyword: 'required',
                      params: { missingProperty: 'explanation' },
                      message: "must have required property '" + 'explanation' + "'",
                    };
                    if (vErrors === null) {
                      vErrors = [err19];
                    } else {
                      vErrors.push(err19);
                    }
                    errors++;
                  }
                }
                var _valid0 = _errs21 === errors;
                valid5 = _valid0;
              }
              if (!valid5) {
                const err20 = {
                  instancePath: instancePath + '/directorships/' + i0 + '/change',
                  schemaPath: '#/$defs/ChangeFlag/if',
                  keyword: 'if',
                  params: { failingKeyword: 'then' },
                  message: 'must match "then" schema',
                };
                if (vErrors === null) {
                  vErrors = [err20];
                } else {
                  vErrors.push(err20);
                }
                errors++;
              }
              if (data6 && typeof data6 == 'object' && !Array.isArray(data6)) {
                if (data6.changed === undefined) {
                  const err21 = {
                    instancePath: instancePath + '/directorships/' + i0 + '/change',
                    schemaPath: '#/$defs/ChangeFlag/required',
                    keyword: 'required',
                    params: { missingProperty: 'changed' },
                    message: "must have required property '" + 'changed' + "'",
                  };
                  if (vErrors === null) {
                    vErrors = [err21];
                  } else {
                    vErrors.push(err21);
                  }
                  errors++;
                }
                for (const key2 in data6) {
                  if (!(key2 === 'changed' || key2 === 'kind' || key2 === 'explanation')) {
                    const err22 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/change',
                      schemaPath: '#/$defs/ChangeFlag/additionalProperties',
                      keyword: 'additionalProperties',
                      params: { additionalProperty: key2 },
                      message: 'must NOT have additional properties',
                    };
                    if (vErrors === null) {
                      vErrors = [err22];
                    } else {
                      vErrors.push(err22);
                    }
                    errors++;
                  }
                }
                if (data6.changed !== undefined) {
                  if (typeof data6.changed !== 'boolean') {
                    const err23 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/change/changed',
                      schemaPath: '#/$defs/ChangeFlag/properties/changed/type',
                      keyword: 'type',
                      params: { type: 'boolean' },
                      message: 'must be boolean',
                    };
                    if (vErrors === null) {
                      vErrors = [err23];
                    } else {
                      vErrors.push(err23);
                    }
                    errors++;
                  }
                }
                if (data6.kind !== undefined) {
                  let data9 = data6.kind;
                  if (typeof data9 !== 'string') {
                    const err24 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/change/kind',
                      schemaPath: '#/$defs/ChangeFlag/properties/kind/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    };
                    if (vErrors === null) {
                      vErrors = [err24];
                    } else {
                      vErrors.push(err24);
                    }
                    errors++;
                  }
                  if (!(
                    data9 === 'value-change' ||
                    data9 === 'acquisition' ||
                    data9 === 'disposal' ||
                    data9 === 'new-source' ||
                    data9 === 'source-ended' ||
                    data9 === 'settled'
                  )) {
                    const err25 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/change/kind',
                      schemaPath: '#/$defs/ChangeFlag/properties/kind/enum',
                      keyword: 'enum',
                      params: { allowedValues: schema44.properties.kind.enum },
                      message: 'must be equal to one of the allowed values',
                    };
                    if (vErrors === null) {
                      vErrors = [err25];
                    } else {
                      vErrors.push(err25);
                    }
                    errors++;
                  }
                }
                if (data6.explanation !== undefined) {
                  let data10 = data6.explanation;
                  if (typeof data10 === 'string') {
                    if (func2(data10) > 1000) {
                      const err26 = {
                        instancePath: instancePath + '/directorships/' + i0 + '/change/explanation',
                        schemaPath: '#/$defs/ChangeFlag/properties/explanation/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 1000 },
                        message: 'must NOT have more than 1000 characters',
                      };
                      if (vErrors === null) {
                        vErrors = [err26];
                      } else {
                        vErrors.push(err26);
                      }
                      errors++;
                    }
                    if (func2(data10) < 1) {
                      const err27 = {
                        instancePath: instancePath + '/directorships/' + i0 + '/change/explanation',
                        schemaPath: '#/$defs/ChangeFlag/properties/explanation/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      };
                      if (vErrors === null) {
                        vErrors = [err27];
                      } else {
                        vErrors.push(err27);
                      }
                      errors++;
                    }
                  } else {
                    const err28 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/change/explanation',
                      schemaPath: '#/$defs/ChangeFlag/properties/explanation/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    };
                    if (vErrors === null) {
                      vErrors = [err28];
                    } else {
                      vErrors.push(err28);
                    }
                    errors++;
                  }
                }
              } else {
                const err29 = {
                  instancePath: instancePath + '/directorships/' + i0 + '/change',
                  schemaPath: '#/$defs/ChangeFlag/type',
                  keyword: 'type',
                  params: { type: 'object' },
                  message: 'must be object',
                };
                if (vErrors === null) {
                  vErrors = [err29];
                } else {
                  vErrors.push(err29);
                }
                errors++;
              }
            }
            if (data1.source !== undefined) {
              let data11 = data1.source;
              if (data11 && typeof data11 == 'object' && !Array.isArray(data11)) {
                if (data11.kind === undefined) {
                  const err30 = {
                    instancePath: instancePath + '/directorships/' + i0 + '/source',
                    schemaPath: '#/$defs/ItemSource/required',
                    keyword: 'required',
                    params: { missingProperty: 'kind' },
                    message: "must have required property '" + 'kind' + "'",
                  };
                  if (vErrors === null) {
                    vErrors = [err30];
                  } else {
                    vErrors.push(err30);
                  }
                  errors++;
                }
                if (data11.suggestionId === undefined) {
                  const err31 = {
                    instancePath: instancePath + '/directorships/' + i0 + '/source',
                    schemaPath: '#/$defs/ItemSource/required',
                    keyword: 'required',
                    params: { missingProperty: 'suggestionId' },
                    message: "must have required property '" + 'suggestionId' + "'",
                  };
                  if (vErrors === null) {
                    vErrors = [err31];
                  } else {
                    vErrors.push(err31);
                  }
                  errors++;
                }
                if (data11.at === undefined) {
                  const err32 = {
                    instancePath: instancePath + '/directorships/' + i0 + '/source',
                    schemaPath: '#/$defs/ItemSource/required',
                    keyword: 'required',
                    params: { missingProperty: 'at' },
                    message: "must have required property '" + 'at' + "'",
                  };
                  if (vErrors === null) {
                    vErrors = [err32];
                  } else {
                    vErrors.push(err32);
                  }
                  errors++;
                }
                for (const key3 in data11) {
                  if (!(
                    key3 === 'kind' ||
                    key3 === 'suggestionId' ||
                    key3 === 'verificationResultId' ||
                    key3 === 'aiJobId' ||
                    key3 === 'at'
                  )) {
                    const err33 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/source',
                      schemaPath: '#/$defs/ItemSource/additionalProperties',
                      keyword: 'additionalProperties',
                      params: { additionalProperty: key3 },
                      message: 'must NOT have additional properties',
                    };
                    if (vErrors === null) {
                      vErrors = [err33];
                    } else {
                      vErrors.push(err33);
                    }
                    errors++;
                  }
                }
                if (data11.kind !== undefined) {
                  let data12 = data11.kind;
                  if (typeof data12 !== 'string') {
                    const err34 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/source/kind',
                      schemaPath: '#/$defs/ItemSource/properties/kind/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    };
                    if (vErrors === null) {
                      vErrors = [err34];
                    } else {
                      vErrors.push(err34);
                    }
                    errors++;
                  }
                  if (!(
                    data12 === 'kra' ||
                    data12 === 'ntsa' ||
                    data12 === 'brs' ||
                    data12 === 'ardhisasa' ||
                    data12 === 'document'
                  )) {
                    const err35 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/source/kind',
                      schemaPath: '#/$defs/ItemSource/properties/kind/enum',
                      keyword: 'enum',
                      params: { allowedValues: schema45.properties.kind.enum },
                      message: 'must be equal to one of the allowed values',
                    };
                    if (vErrors === null) {
                      vErrors = [err35];
                    } else {
                      vErrors.push(err35);
                    }
                    errors++;
                  }
                }
                if (data11.suggestionId !== undefined) {
                  let data13 = data11.suggestionId;
                  if (typeof data13 === 'string') {
                    if (!formats10.test(data13)) {
                      const err36 = {
                        instancePath:
                          instancePath + '/directorships/' + i0 + '/source/suggestionId',
                        schemaPath: '#/$defs/ItemSource/properties/suggestionId/format',
                        keyword: 'format',
                        params: { format: 'uuid' },
                        message: 'must match format "' + 'uuid' + '"',
                      };
                      if (vErrors === null) {
                        vErrors = [err36];
                      } else {
                        vErrors.push(err36);
                      }
                      errors++;
                    }
                  } else {
                    const err37 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/source/suggestionId',
                      schemaPath: '#/$defs/ItemSource/properties/suggestionId/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    };
                    if (vErrors === null) {
                      vErrors = [err37];
                    } else {
                      vErrors.push(err37);
                    }
                    errors++;
                  }
                }
                if (data11.verificationResultId !== undefined) {
                  let data14 = data11.verificationResultId;
                  if (typeof data14 === 'string') {
                    if (!formats10.test(data14)) {
                      const err38 = {
                        instancePath:
                          instancePath + '/directorships/' + i0 + '/source/verificationResultId',
                        schemaPath: '#/$defs/ItemSource/properties/verificationResultId/format',
                        keyword: 'format',
                        params: { format: 'uuid' },
                        message: 'must match format "' + 'uuid' + '"',
                      };
                      if (vErrors === null) {
                        vErrors = [err38];
                      } else {
                        vErrors.push(err38);
                      }
                      errors++;
                    }
                  } else {
                    const err39 = {
                      instancePath:
                        instancePath + '/directorships/' + i0 + '/source/verificationResultId',
                      schemaPath: '#/$defs/ItemSource/properties/verificationResultId/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    };
                    if (vErrors === null) {
                      vErrors = [err39];
                    } else {
                      vErrors.push(err39);
                    }
                    errors++;
                  }
                }
                if (data11.aiJobId !== undefined) {
                  let data15 = data11.aiJobId;
                  if (typeof data15 === 'string') {
                    if (!formats10.test(data15)) {
                      const err40 = {
                        instancePath: instancePath + '/directorships/' + i0 + '/source/aiJobId',
                        schemaPath: '#/$defs/ItemSource/properties/aiJobId/format',
                        keyword: 'format',
                        params: { format: 'uuid' },
                        message: 'must match format "' + 'uuid' + '"',
                      };
                      if (vErrors === null) {
                        vErrors = [err40];
                      } else {
                        vErrors.push(err40);
                      }
                      errors++;
                    }
                  } else {
                    const err41 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/source/aiJobId',
                      schemaPath: '#/$defs/ItemSource/properties/aiJobId/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    };
                    if (vErrors === null) {
                      vErrors = [err41];
                    } else {
                      vErrors.push(err41);
                    }
                    errors++;
                  }
                }
                if (data11.at !== undefined) {
                  let data16 = data11.at;
                  if (typeof data16 === 'string') {
                    if (!formats32.validate(data16)) {
                      const err42 = {
                        instancePath: instancePath + '/directorships/' + i0 + '/source/at',
                        schemaPath: '#/$defs/ItemSource/properties/at/format',
                        keyword: 'format',
                        params: { format: 'date-time' },
                        message: 'must match format "' + 'date-time' + '"',
                      };
                      if (vErrors === null) {
                        vErrors = [err42];
                      } else {
                        vErrors.push(err42);
                      }
                      errors++;
                    }
                  } else {
                    const err43 = {
                      instancePath: instancePath + '/directorships/' + i0 + '/source/at',
                      schemaPath: '#/$defs/ItemSource/properties/at/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    };
                    if (vErrors === null) {
                      vErrors = [err43];
                    } else {
                      vErrors.push(err43);
                    }
                    errors++;
                  }
                }
              } else {
                const err44 = {
                  instancePath: instancePath + '/directorships/' + i0 + '/source',
                  schemaPath: '#/$defs/ItemSource/type',
                  keyword: 'type',
                  params: { type: 'object' },
                  message: 'must be object',
                };
                if (vErrors === null) {
                  vErrors = [err44];
                } else {
                  vErrors.push(err44);
                }
                errors++;
              }
            }
          } else {
            const err45 = {
              instancePath: instancePath + '/directorships/' + i0,
              schemaPath: '#/properties/directorships/items/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
        }
      } else {
        const err46 = {
          instancePath: instancePath + '/directorships',
          schemaPath: '#/properties/directorships/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err46];
        } else {
          vErrors.push(err46);
        }
        errors++;
      }
    }
    if (data.memberships !== undefined) {
      let data17 = data.memberships;
      if (Array.isArray(data17)) {
        const len1 = data17.length;
        for (let i1 = 0; i1 < len1; i1++) {
          let data18 = data17[i1];
          if (data18 && typeof data18 == 'object' && !Array.isArray(data18)) {
            if (data18.entity === undefined) {
              const err47 = {
                instancePath: instancePath + '/memberships/' + i1,
                schemaPath: '#/properties/memberships/items/required',
                keyword: 'required',
                params: { missingProperty: 'entity' },
                message: "must have required property '" + 'entity' + "'",
              };
              if (vErrors === null) {
                vErrors = [err47];
              } else {
                vErrors.push(err47);
              }
              errors++;
            }
            if (data18.kind === undefined) {
              const err48 = {
                instancePath: instancePath + '/memberships/' + i1,
                schemaPath: '#/properties/memberships/items/required',
                keyword: 'required',
                params: { missingProperty: 'kind' },
                message: "must have required property '" + 'kind' + "'",
              };
              if (vErrors === null) {
                vErrors = [err48];
              } else {
                vErrors.push(err48);
              }
              errors++;
            }
            for (const key4 in data18) {
              if (!(key4 === 'entity' || key4 === 'kind' || key4 === 'change')) {
                const err49 = {
                  instancePath: instancePath + '/memberships/' + i1,
                  schemaPath: '#/properties/memberships/items/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key4 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err49];
                } else {
                  vErrors.push(err49);
                }
                errors++;
              }
            }
            if (data18.entity !== undefined) {
              let data19 = data18.entity;
              if (typeof data19 === 'string') {
                if (func2(data19) > 200) {
                  const err50 = {
                    instancePath: instancePath + '/memberships/' + i1 + '/entity',
                    schemaPath: '#/properties/memberships/items/properties/entity/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 200 },
                    message: 'must NOT have more than 200 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err50];
                  } else {
                    vErrors.push(err50);
                  }
                  errors++;
                }
              } else {
                const err51 = {
                  instancePath: instancePath + '/memberships/' + i1 + '/entity',
                  schemaPath: '#/properties/memberships/items/properties/entity/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err51];
                } else {
                  vErrors.push(err51);
                }
                errors++;
              }
            }
            if (data18.kind !== undefined) {
              let data20 = data18.kind;
              if (typeof data20 !== 'string') {
                const err52 = {
                  instancePath: instancePath + '/memberships/' + i1 + '/kind',
                  schemaPath: '#/properties/memberships/items/properties/kind/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err52];
                } else {
                  vErrors.push(err52);
                }
                errors++;
              }
              if (!(
                data20 === 'company' ||
                data20 === 'partnership' ||
                data20 === 'society' ||
                data20 === 'club' ||
                data20 === 'foundation' ||
                data20 === 'trust' ||
                data20 === 'other'
              )) {
                const err53 = {
                  instancePath: instancePath + '/memberships/' + i1 + '/kind',
                  schemaPath: '#/properties/memberships/items/properties/kind/enum',
                  keyword: 'enum',
                  params: {
                    allowedValues: schema61.properties.memberships.items.properties.kind.enum,
                  },
                  message: 'must be equal to one of the allowed values',
                };
                if (vErrors === null) {
                  vErrors = [err53];
                } else {
                  vErrors.push(err53);
                }
                errors++;
              }
            }
            if (data18.change !== undefined) {
              let data21 = data18.change;
              const _errs55 = errors;
              let valid14 = true;
              const _errs56 = errors;
              if (data21 && typeof data21 == 'object' && !Array.isArray(data21)) {
                if (data21.changed !== undefined) {
                  if (true !== data21.changed) {
                    const err54 = {};
                    if (vErrors === null) {
                      vErrors = [err54];
                    } else {
                      vErrors.push(err54);
                    }
                    errors++;
                  }
                }
              }
              var _valid1 = _errs56 === errors;
              errors = _errs55;
              if (vErrors !== null) {
                if (_errs55) {
                  vErrors.length = _errs55;
                } else {
                  vErrors = null;
                }
              }
              if (_valid1) {
                const _errs58 = errors;
                if (data21 && typeof data21 == 'object' && !Array.isArray(data21)) {
                  if (data21.changed === undefined) {
                    const err55 = {
                      instancePath: instancePath + '/memberships/' + i1 + '/change',
                      schemaPath: '#/$defs/ChangeFlag/then/required',
                      keyword: 'required',
                      params: { missingProperty: 'changed' },
                      message: "must have required property '" + 'changed' + "'",
                    };
                    if (vErrors === null) {
                      vErrors = [err55];
                    } else {
                      vErrors.push(err55);
                    }
                    errors++;
                  }
                  if (data21.kind === undefined) {
                    const err56 = {
                      instancePath: instancePath + '/memberships/' + i1 + '/change',
                      schemaPath: '#/$defs/ChangeFlag/then/required',
                      keyword: 'required',
                      params: { missingProperty: 'kind' },
                      message: "must have required property '" + 'kind' + "'",
                    };
                    if (vErrors === null) {
                      vErrors = [err56];
                    } else {
                      vErrors.push(err56);
                    }
                    errors++;
                  }
                  if (data21.explanation === undefined) {
                    const err57 = {
                      instancePath: instancePath + '/memberships/' + i1 + '/change',
                      schemaPath: '#/$defs/ChangeFlag/then/required',
                      keyword: 'required',
                      params: { missingProperty: 'explanation' },
                      message: "must have required property '" + 'explanation' + "'",
                    };
                    if (vErrors === null) {
                      vErrors = [err57];
                    } else {
                      vErrors.push(err57);
                    }
                    errors++;
                  }
                }
                var _valid1 = _errs58 === errors;
                valid14 = _valid1;
              }
              if (!valid14) {
                const err58 = {
                  instancePath: instancePath + '/memberships/' + i1 + '/change',
                  schemaPath: '#/$defs/ChangeFlag/if',
                  keyword: 'if',
                  params: { failingKeyword: 'then' },
                  message: 'must match "then" schema',
                };
                if (vErrors === null) {
                  vErrors = [err58];
                } else {
                  vErrors.push(err58);
                }
                errors++;
              }
              if (data21 && typeof data21 == 'object' && !Array.isArray(data21)) {
                if (data21.changed === undefined) {
                  const err59 = {
                    instancePath: instancePath + '/memberships/' + i1 + '/change',
                    schemaPath: '#/$defs/ChangeFlag/required',
                    keyword: 'required',
                    params: { missingProperty: 'changed' },
                    message: "must have required property '" + 'changed' + "'",
                  };
                  if (vErrors === null) {
                    vErrors = [err59];
                  } else {
                    vErrors.push(err59);
                  }
                  errors++;
                }
                for (const key5 in data21) {
                  if (!(key5 === 'changed' || key5 === 'kind' || key5 === 'explanation')) {
                    const err60 = {
                      instancePath: instancePath + '/memberships/' + i1 + '/change',
                      schemaPath: '#/$defs/ChangeFlag/additionalProperties',
                      keyword: 'additionalProperties',
                      params: { additionalProperty: key5 },
                      message: 'must NOT have additional properties',
                    };
                    if (vErrors === null) {
                      vErrors = [err60];
                    } else {
                      vErrors.push(err60);
                    }
                    errors++;
                  }
                }
                if (data21.changed !== undefined) {
                  if (typeof data21.changed !== 'boolean') {
                    const err61 = {
                      instancePath: instancePath + '/memberships/' + i1 + '/change/changed',
                      schemaPath: '#/$defs/ChangeFlag/properties/changed/type',
                      keyword: 'type',
                      params: { type: 'boolean' },
                      message: 'must be boolean',
                    };
                    if (vErrors === null) {
                      vErrors = [err61];
                    } else {
                      vErrors.push(err61);
                    }
                    errors++;
                  }
                }
                if (data21.kind !== undefined) {
                  let data24 = data21.kind;
                  if (typeof data24 !== 'string') {
                    const err62 = {
                      instancePath: instancePath + '/memberships/' + i1 + '/change/kind',
                      schemaPath: '#/$defs/ChangeFlag/properties/kind/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    };
                    if (vErrors === null) {
                      vErrors = [err62];
                    } else {
                      vErrors.push(err62);
                    }
                    errors++;
                  }
                  if (!(
                    data24 === 'value-change' ||
                    data24 === 'acquisition' ||
                    data24 === 'disposal' ||
                    data24 === 'new-source' ||
                    data24 === 'source-ended' ||
                    data24 === 'settled'
                  )) {
                    const err63 = {
                      instancePath: instancePath + '/memberships/' + i1 + '/change/kind',
                      schemaPath: '#/$defs/ChangeFlag/properties/kind/enum',
                      keyword: 'enum',
                      params: { allowedValues: schema44.properties.kind.enum },
                      message: 'must be equal to one of the allowed values',
                    };
                    if (vErrors === null) {
                      vErrors = [err63];
                    } else {
                      vErrors.push(err63);
                    }
                    errors++;
                  }
                }
                if (data21.explanation !== undefined) {
                  let data25 = data21.explanation;
                  if (typeof data25 === 'string') {
                    if (func2(data25) > 1000) {
                      const err64 = {
                        instancePath: instancePath + '/memberships/' + i1 + '/change/explanation',
                        schemaPath: '#/$defs/ChangeFlag/properties/explanation/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 1000 },
                        message: 'must NOT have more than 1000 characters',
                      };
                      if (vErrors === null) {
                        vErrors = [err64];
                      } else {
                        vErrors.push(err64);
                      }
                      errors++;
                    }
                    if (func2(data25) < 1) {
                      const err65 = {
                        instancePath: instancePath + '/memberships/' + i1 + '/change/explanation',
                        schemaPath: '#/$defs/ChangeFlag/properties/explanation/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      };
                      if (vErrors === null) {
                        vErrors = [err65];
                      } else {
                        vErrors.push(err65);
                      }
                      errors++;
                    }
                  } else {
                    const err66 = {
                      instancePath: instancePath + '/memberships/' + i1 + '/change/explanation',
                      schemaPath: '#/$defs/ChangeFlag/properties/explanation/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    };
                    if (vErrors === null) {
                      vErrors = [err66];
                    } else {
                      vErrors.push(err66);
                    }
                    errors++;
                  }
                }
              } else {
                const err67 = {
                  instancePath: instancePath + '/memberships/' + i1 + '/change',
                  schemaPath: '#/$defs/ChangeFlag/type',
                  keyword: 'type',
                  params: { type: 'object' },
                  message: 'must be object',
                };
                if (vErrors === null) {
                  vErrors = [err67];
                } else {
                  vErrors.push(err67);
                }
                errors++;
              }
            }
          } else {
            const err68 = {
              instancePath: instancePath + '/memberships/' + i1,
              schemaPath: '#/properties/memberships/items/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err68];
            } else {
              vErrors.push(err68);
            }
            errors++;
          }
        }
      } else {
        const err69 = {
          instancePath: instancePath + '/memberships',
          schemaPath: '#/properties/memberships/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err69];
        } else {
          vErrors.push(err69);
        }
        errors++;
      }
    }
    if (data.dualCitizenship !== undefined) {
      let data26 = data.dualCitizenship;
      if (data26 && typeof data26 == 'object' && !Array.isArray(data26)) {
        if (data26.holds === undefined) {
          const err70 = {
            instancePath: instancePath + '/dualCitizenship',
            schemaPath: '#/properties/dualCitizenship/required',
            keyword: 'required',
            params: { missingProperty: 'holds' },
            message: "must have required property '" + 'holds' + "'",
          };
          if (vErrors === null) {
            vErrors = [err70];
          } else {
            vErrors.push(err70);
          }
          errors++;
        }
        if (data26.pendingApplication === undefined) {
          const err71 = {
            instancePath: instancePath + '/dualCitizenship',
            schemaPath: '#/properties/dualCitizenship/required',
            keyword: 'required',
            params: { missingProperty: 'pendingApplication' },
            message: "must have required property '" + 'pendingApplication' + "'",
          };
          if (vErrors === null) {
            vErrors = [err71];
          } else {
            vErrors.push(err71);
          }
          errors++;
        }
        for (const key6 in data26) {
          if (!(key6 === 'holds' || key6 === 'country' || key6 === 'pendingApplication')) {
            const err72 = {
              instancePath: instancePath + '/dualCitizenship',
              schemaPath: '#/properties/dualCitizenship/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key6 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err72];
            } else {
              vErrors.push(err72);
            }
            errors++;
          }
        }
        if (data26.holds !== undefined) {
          if (typeof data26.holds !== 'boolean') {
            const err73 = {
              instancePath: instancePath + '/dualCitizenship/holds',
              schemaPath: '#/properties/dualCitizenship/properties/holds/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err73];
            } else {
              vErrors.push(err73);
            }
            errors++;
          }
        }
        if (data26.country !== undefined) {
          let data28 = data26.country;
          if (typeof data28 === 'string') {
            if (!pattern11.test(data28)) {
              const err74 = {
                instancePath: instancePath + '/dualCitizenship/country',
                schemaPath: '#/properties/dualCitizenship/properties/country/pattern',
                keyword: 'pattern',
                params: { pattern: '^[A-Z]{2}$' },
                message: 'must match pattern "' + '^[A-Z]{2}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err74];
              } else {
                vErrors.push(err74);
              }
              errors++;
            }
          } else {
            const err75 = {
              instancePath: instancePath + '/dualCitizenship/country',
              schemaPath: '#/properties/dualCitizenship/properties/country/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err75];
            } else {
              vErrors.push(err75);
            }
            errors++;
          }
        }
        if (data26.pendingApplication !== undefined) {
          if (typeof data26.pendingApplication !== 'boolean') {
            const err76 = {
              instancePath: instancePath + '/dualCitizenship/pendingApplication',
              schemaPath: '#/properties/dualCitizenship/properties/pendingApplication/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err76];
            } else {
              vErrors.push(err76);
            }
            errors++;
          }
        }
      } else {
        const err77 = {
          instancePath: instancePath + '/dualCitizenship',
          schemaPath: '#/properties/dualCitizenship/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err77];
        } else {
          vErrors.push(err77);
        }
        errors++;
      }
    }
    if (data.pendingCases !== undefined) {
      let data30 = data.pendingCases;
      if (Array.isArray(data30)) {
        const len2 = data30.length;
        for (let i2 = 0; i2 < len2; i2++) {
          let data31 = data30[i2];
          if (data31 && typeof data31 == 'object' && !Array.isArray(data31)) {
            if (data31.forum === undefined) {
              const err78 = {
                instancePath: instancePath + '/pendingCases/' + i2,
                schemaPath: '#/properties/pendingCases/items/required',
                keyword: 'required',
                params: { missingProperty: 'forum' },
                message: "must have required property '" + 'forum' + "'",
              };
              if (vErrors === null) {
                vErrors = [err78];
              } else {
                vErrors.push(err78);
              }
              errors++;
            }
            if (data31.reference === undefined) {
              const err79 = {
                instancePath: instancePath + '/pendingCases/' + i2,
                schemaPath: '#/properties/pendingCases/items/required',
                keyword: 'required',
                params: { missingProperty: 'reference' },
                message: "must have required property '" + 'reference' + "'",
              };
              if (vErrors === null) {
                vErrors = [err79];
              } else {
                vErrors.push(err79);
              }
              errors++;
            }
            if (data31.nature === undefined) {
              const err80 = {
                instancePath: instancePath + '/pendingCases/' + i2,
                schemaPath: '#/properties/pendingCases/items/required',
                keyword: 'required',
                params: { missingProperty: 'nature' },
                message: "must have required property '" + 'nature' + "'",
              };
              if (vErrors === null) {
                vErrors = [err80];
              } else {
                vErrors.push(err80);
              }
              errors++;
            }
            for (const key7 in data31) {
              if (!(key7 === 'forum' || key7 === 'reference' || key7 === 'nature')) {
                const err81 = {
                  instancePath: instancePath + '/pendingCases/' + i2,
                  schemaPath: '#/properties/pendingCases/items/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key7 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err81];
                } else {
                  vErrors.push(err81);
                }
                errors++;
              }
            }
            if (data31.forum !== undefined) {
              let data32 = data31.forum;
              if (typeof data32 === 'string') {
                if (func2(data32) > 200) {
                  const err82 = {
                    instancePath: instancePath + '/pendingCases/' + i2 + '/forum',
                    schemaPath: '#/properties/pendingCases/items/properties/forum/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 200 },
                    message: 'must NOT have more than 200 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err82];
                  } else {
                    vErrors.push(err82);
                  }
                  errors++;
                }
              } else {
                const err83 = {
                  instancePath: instancePath + '/pendingCases/' + i2 + '/forum',
                  schemaPath: '#/properties/pendingCases/items/properties/forum/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err83];
                } else {
                  vErrors.push(err83);
                }
                errors++;
              }
            }
            if (data31.reference !== undefined) {
              let data33 = data31.reference;
              if (typeof data33 === 'string') {
                if (func2(data33) > 100) {
                  const err84 = {
                    instancePath: instancePath + '/pendingCases/' + i2 + '/reference',
                    schemaPath: '#/properties/pendingCases/items/properties/reference/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err84];
                  } else {
                    vErrors.push(err84);
                  }
                  errors++;
                }
              } else {
                const err85 = {
                  instancePath: instancePath + '/pendingCases/' + i2 + '/reference',
                  schemaPath: '#/properties/pendingCases/items/properties/reference/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err85];
                } else {
                  vErrors.push(err85);
                }
                errors++;
              }
            }
            if (data31.nature !== undefined) {
              let data34 = data31.nature;
              if (typeof data34 === 'string') {
                if (func2(data34) > 500) {
                  const err86 = {
                    instancePath: instancePath + '/pendingCases/' + i2 + '/nature',
                    schemaPath: '#/properties/pendingCases/items/properties/nature/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 500 },
                    message: 'must NOT have more than 500 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err86];
                  } else {
                    vErrors.push(err86);
                  }
                  errors++;
                }
              } else {
                const err87 = {
                  instancePath: instancePath + '/pendingCases/' + i2 + '/nature',
                  schemaPath: '#/properties/pendingCases/items/properties/nature/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err87];
                } else {
                  vErrors.push(err87);
                }
                errors++;
              }
            }
          } else {
            const err88 = {
              instancePath: instancePath + '/pendingCases/' + i2,
              schemaPath: '#/properties/pendingCases/items/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err88];
            } else {
              vErrors.push(err88);
            }
            errors++;
          }
        }
      } else {
        const err89 = {
          instancePath: instancePath + '/pendingCases',
          schemaPath: '#/properties/pendingCases/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err89];
        } else {
          vErrors.push(err89);
        }
        errors++;
      }
    }
  } else {
    const err90 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err90];
    } else {
      vErrors.push(err90);
    }
    errors++;
  }
  validate35.errors = vErrors;
  return errors === 0;
}
validate35.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate20(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  /*# sourceURL="https://adili.go.ke/schemas/declaration.v1.json" */ let vErrors = null;
  let errors = 0;
  const evaluated0 = validate20.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.schemaVersion === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'schemaVersion' },
        message: "must have required property '" + 'schemaVersion' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'type' },
        message: "must have required property '" + 'type' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.statementDate === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'statementDate' },
        message: "must have required property '" + 'statementDate' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.incomePeriod === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'incomePeriod' },
        message: "must have required property '" + 'incomePeriod' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.officer === undefined) {
      const err4 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'officer' },
        message: "must have required property '" + 'officer' + "'",
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.spouses === undefined) {
      const err5 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'spouses' },
        message: "must have required property '" + 'spouses' + "'",
      };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.children === undefined) {
      const err6 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'children' },
        message: "must have required property '" + 'children' + "'",
      };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.statements === undefined) {
      const err7 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'statements' },
        message: "must have required property '" + 'statements' + "'",
      };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.otherInformation === undefined) {
      const err8 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'otherInformation' },
        message: "must have required property '" + 'otherInformation' + "'",
      };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.attestation === undefined) {
      const err9 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'attestation' },
        message: "must have required property '" + 'attestation' + "'",
      };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema31.properties, key0)) {
        const err10 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.schemaVersion !== undefined) {
      if ('declaration.v1' !== data.schemaVersion) {
        const err11 = {
          instancePath: instancePath + '/schemaVersion',
          schemaPath: '#/properties/schemaVersion/const',
          keyword: 'const',
          params: { allowedValue: 'declaration.v1' },
          message: 'must be equal to constant',
        };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.type !== undefined) {
      let data1 = data.type;
      if (typeof data1 !== 'string') {
        const err12 = {
          instancePath: instancePath + '/type',
          schemaPath: '#/properties/type/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (!(data1 === 'initial' || data1 === 'biennial' || data1 === 'final')) {
        const err13 = {
          instancePath: instancePath + '/type',
          schemaPath: '#/properties/type/enum',
          keyword: 'enum',
          params: { allowedValues: schema31.properties.type.enum },
          message: 'must be equal to one of the allowed values',
        };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.statementDate !== undefined) {
      let data2 = data.statementDate;
      if (typeof data2 === 'string') {
        if (!formats0.validate(data2)) {
          const err14 = {
            instancePath: instancePath + '/statementDate',
            schemaPath: '#/properties/statementDate/format',
            keyword: 'format',
            params: { format: 'date' },
            message: 'must match format "' + 'date' + '"',
          };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      } else {
        const err15 = {
          instancePath: instancePath + '/statementDate',
          schemaPath: '#/properties/statementDate/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.incomePeriod !== undefined) {
      let data3 = data.incomePeriod;
      if (data3 && typeof data3 == 'object' && !Array.isArray(data3)) {
        if (data3.from === undefined) {
          const err16 = {
            instancePath: instancePath + '/incomePeriod',
            schemaPath: '#/properties/incomePeriod/required',
            keyword: 'required',
            params: { missingProperty: 'from' },
            message: "must have required property '" + 'from' + "'",
          };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
        if (data3.to === undefined) {
          const err17 = {
            instancePath: instancePath + '/incomePeriod',
            schemaPath: '#/properties/incomePeriod/required',
            keyword: 'required',
            params: { missingProperty: 'to' },
            message: "must have required property '" + 'to' + "'",
          };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
        if (data3.fromSource === undefined) {
          const err18 = {
            instancePath: instancePath + '/incomePeriod',
            schemaPath: '#/properties/incomePeriod/required',
            keyword: 'required',
            params: { missingProperty: 'fromSource' },
            message: "must have required property '" + 'fromSource' + "'",
          };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        for (const key1 in data3) {
          if (!(key1 === 'from' || key1 === 'to' || key1 === 'fromSource')) {
            const err19 = {
              instancePath: instancePath + '/incomePeriod',
              schemaPath: '#/properties/incomePeriod/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err19];
            } else {
              vErrors.push(err19);
            }
            errors++;
          }
        }
        if (data3.from !== undefined) {
          let data4 = data3.from;
          if (typeof data4 === 'string') {
            if (!formats0.validate(data4)) {
              const err20 = {
                instancePath: instancePath + '/incomePeriod/from',
                schemaPath: '#/properties/incomePeriod/properties/from/format',
                keyword: 'format',
                params: { format: 'date' },
                message: 'must match format "' + 'date' + '"',
              };
              if (vErrors === null) {
                vErrors = [err20];
              } else {
                vErrors.push(err20);
              }
              errors++;
            }
          } else {
            const err21 = {
              instancePath: instancePath + '/incomePeriod/from',
              schemaPath: '#/properties/incomePeriod/properties/from/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err21];
            } else {
              vErrors.push(err21);
            }
            errors++;
          }
        }
        if (data3.to !== undefined) {
          let data5 = data3.to;
          if (typeof data5 === 'string') {
            if (!formats0.validate(data5)) {
              const err22 = {
                instancePath: instancePath + '/incomePeriod/to',
                schemaPath: '#/properties/incomePeriod/properties/to/format',
                keyword: 'format',
                params: { format: 'date' },
                message: 'must match format "' + 'date' + '"',
              };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
          } else {
            const err23 = {
              instancePath: instancePath + '/incomePeriod/to',
              schemaPath: '#/properties/incomePeriod/properties/to/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err23];
            } else {
              vErrors.push(err23);
            }
            errors++;
          }
        }
        if (data3.fromSource !== undefined) {
          let data6 = data3.fromSource;
          if (typeof data6 !== 'string') {
            const err24 = {
              instancePath: instancePath + '/incomePeriod/fromSource',
              schemaPath: '#/properties/incomePeriod/properties/fromSource/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err24];
            } else {
              vErrors.push(err24);
            }
            errors++;
          }
          if (!(data6 === 'declared' || data6 === 'assumed')) {
            const err25 = {
              instancePath: instancePath + '/incomePeriod/fromSource',
              schemaPath: '#/properties/incomePeriod/properties/fromSource/enum',
              keyword: 'enum',
              params: {
                allowedValues: schema31.properties.incomePeriod.properties.fromSource.enum,
              },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err25];
            } else {
              vErrors.push(err25);
            }
            errors++;
          }
        }
      } else {
        const err26 = {
          instancePath: instancePath + '/incomePeriod',
          schemaPath: '#/properties/incomePeriod/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.officer !== undefined) {
      let data7 = data.officer;
      if (data7 && typeof data7 == 'object' && !Array.isArray(data7)) {
        if (data7.name === undefined) {
          const err27 = {
            instancePath: instancePath + '/officer',
            schemaPath: '#/properties/officer/required',
            keyword: 'required',
            params: { missingProperty: 'name' },
            message: "must have required property '" + 'name' + "'",
          };
          if (vErrors === null) {
            vErrors = [err27];
          } else {
            vErrors.push(err27);
          }
          errors++;
        }
        if (data7.birth === undefined) {
          const err28 = {
            instancePath: instancePath + '/officer',
            schemaPath: '#/properties/officer/required',
            keyword: 'required',
            params: { missingProperty: 'birth' },
            message: "must have required property '" + 'birth' + "'",
          };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
        if (data7.maritalStatus === undefined) {
          const err29 = {
            instancePath: instancePath + '/officer',
            schemaPath: '#/properties/officer/required',
            keyword: 'required',
            params: { missingProperty: 'maritalStatus' },
            message: "must have required property '" + 'maritalStatus' + "'",
          };
          if (vErrors === null) {
            vErrors = [err29];
          } else {
            vErrors.push(err29);
          }
          errors++;
        }
        if (data7.address === undefined) {
          const err30 = {
            instancePath: instancePath + '/officer',
            schemaPath: '#/properties/officer/required',
            keyword: 'required',
            params: { missingProperty: 'address' },
            message: "must have required property '" + 'address' + "'",
          };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        if (data7.employment === undefined) {
          const err31 = {
            instancePath: instancePath + '/officer',
            schemaPath: '#/properties/officer/required',
            keyword: 'required',
            params: { missingProperty: 'employment' },
            message: "must have required property '" + 'employment' + "'",
          };
          if (vErrors === null) {
            vErrors = [err31];
          } else {
            vErrors.push(err31);
          }
          errors++;
        }
        for (const key2 in data7) {
          if (!(
            key2 === 'name' ||
            key2 === 'birth' ||
            key2 === 'maritalStatus' ||
            key2 === 'maritalStatusChange' ||
            key2 === 'address' ||
            key2 === 'employment'
          )) {
            const err32 = {
              instancePath: instancePath + '/officer',
              schemaPath: '#/properties/officer/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key2 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
        if (data7.name !== undefined) {
          let data8 = data7.name;
          if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
            if (data8.surname === undefined) {
              const err33 = {
                instancePath: instancePath + '/officer/name',
                schemaPath: '#/$defs/PersonName/required',
                keyword: 'required',
                params: { missingProperty: 'surname' },
                message: "must have required property '" + 'surname' + "'",
              };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
            }
            if (data8.firstName === undefined) {
              const err34 = {
                instancePath: instancePath + '/officer/name',
                schemaPath: '#/$defs/PersonName/required',
                keyword: 'required',
                params: { missingProperty: 'firstName' },
                message: "must have required property '" + 'firstName' + "'",
              };
              if (vErrors === null) {
                vErrors = [err34];
              } else {
                vErrors.push(err34);
              }
              errors++;
            }
            for (const key3 in data8) {
              if (!(key3 === 'surname' || key3 === 'firstName' || key3 === 'otherNames')) {
                const err35 = {
                  instancePath: instancePath + '/officer/name',
                  schemaPath: '#/$defs/PersonName/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key3 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err35];
                } else {
                  vErrors.push(err35);
                }
                errors++;
              }
            }
            if (data8.surname !== undefined) {
              let data9 = data8.surname;
              if (typeof data9 === 'string') {
                if (func2(data9) > 100) {
                  const err36 = {
                    instancePath: instancePath + '/officer/name/surname',
                    schemaPath: '#/$defs/PersonName/properties/surname/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err36];
                  } else {
                    vErrors.push(err36);
                  }
                  errors++;
                }
                if (func2(data9) < 1) {
                  const err37 = {
                    instancePath: instancePath + '/officer/name/surname',
                    schemaPath: '#/$defs/PersonName/properties/surname/minLength',
                    keyword: 'minLength',
                    params: { limit: 1 },
                    message: 'must NOT have fewer than 1 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err37];
                  } else {
                    vErrors.push(err37);
                  }
                  errors++;
                }
              } else {
                const err38 = {
                  instancePath: instancePath + '/officer/name/surname',
                  schemaPath: '#/$defs/PersonName/properties/surname/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err38];
                } else {
                  vErrors.push(err38);
                }
                errors++;
              }
            }
            if (data8.firstName !== undefined) {
              let data10 = data8.firstName;
              if (typeof data10 === 'string') {
                if (func2(data10) > 100) {
                  const err39 = {
                    instancePath: instancePath + '/officer/name/firstName',
                    schemaPath: '#/$defs/PersonName/properties/firstName/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err39];
                  } else {
                    vErrors.push(err39);
                  }
                  errors++;
                }
                if (func2(data10) < 1) {
                  const err40 = {
                    instancePath: instancePath + '/officer/name/firstName',
                    schemaPath: '#/$defs/PersonName/properties/firstName/minLength',
                    keyword: 'minLength',
                    params: { limit: 1 },
                    message: 'must NOT have fewer than 1 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err40];
                  } else {
                    vErrors.push(err40);
                  }
                  errors++;
                }
              } else {
                const err41 = {
                  instancePath: instancePath + '/officer/name/firstName',
                  schemaPath: '#/$defs/PersonName/properties/firstName/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err41];
                } else {
                  vErrors.push(err41);
                }
                errors++;
              }
            }
            if (data8.otherNames !== undefined) {
              let data11 = data8.otherNames;
              if (typeof data11 === 'string') {
                if (func2(data11) > 200) {
                  const err42 = {
                    instancePath: instancePath + '/officer/name/otherNames',
                    schemaPath: '#/$defs/PersonName/properties/otherNames/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 200 },
                    message: 'must NOT have more than 200 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err42];
                  } else {
                    vErrors.push(err42);
                  }
                  errors++;
                }
              } else {
                const err43 = {
                  instancePath: instancePath + '/officer/name/otherNames',
                  schemaPath: '#/$defs/PersonName/properties/otherNames/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err43];
                } else {
                  vErrors.push(err43);
                }
                errors++;
              }
            }
          } else {
            const err44 = {
              instancePath: instancePath + '/officer/name',
              schemaPath: '#/$defs/PersonName/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err44];
            } else {
              vErrors.push(err44);
            }
            errors++;
          }
        }
        if (data7.birth !== undefined) {
          let data12 = data7.birth;
          if (data12 && typeof data12 == 'object' && !Array.isArray(data12)) {
            if (data12.date === undefined) {
              const err45 = {
                instancePath: instancePath + '/officer/birth',
                schemaPath: '#/properties/officer/properties/birth/required',
                keyword: 'required',
                params: { missingProperty: 'date' },
                message: "must have required property '" + 'date' + "'",
              };
              if (vErrors === null) {
                vErrors = [err45];
              } else {
                vErrors.push(err45);
              }
              errors++;
            }
            if (data12.place === undefined) {
              const err46 = {
                instancePath: instancePath + '/officer/birth',
                schemaPath: '#/properties/officer/properties/birth/required',
                keyword: 'required',
                params: { missingProperty: 'place' },
                message: "must have required property '" + 'place' + "'",
              };
              if (vErrors === null) {
                vErrors = [err46];
              } else {
                vErrors.push(err46);
              }
              errors++;
            }
            for (const key4 in data12) {
              if (!(key4 === 'date' || key4 === 'place')) {
                const err47 = {
                  instancePath: instancePath + '/officer/birth',
                  schemaPath: '#/properties/officer/properties/birth/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key4 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err47];
                } else {
                  vErrors.push(err47);
                }
                errors++;
              }
            }
            if (data12.date !== undefined) {
              let data13 = data12.date;
              if (typeof data13 === 'string') {
                if (!formats0.validate(data13)) {
                  const err48 = {
                    instancePath: instancePath + '/officer/birth/date',
                    schemaPath: '#/properties/officer/properties/birth/properties/date/format',
                    keyword: 'format',
                    params: { format: 'date' },
                    message: 'must match format "' + 'date' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err48];
                  } else {
                    vErrors.push(err48);
                  }
                  errors++;
                }
              } else {
                const err49 = {
                  instancePath: instancePath + '/officer/birth/date',
                  schemaPath: '#/properties/officer/properties/birth/properties/date/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err49];
                } else {
                  vErrors.push(err49);
                }
                errors++;
              }
            }
            if (data12.place !== undefined) {
              let data14 = data12.place;
              if (typeof data14 === 'string') {
                if (func2(data14) > 100) {
                  const err50 = {
                    instancePath: instancePath + '/officer/birth/place',
                    schemaPath: '#/properties/officer/properties/birth/properties/place/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err50];
                  } else {
                    vErrors.push(err50);
                  }
                  errors++;
                }
                if (func2(data14) < 2) {
                  const err51 = {
                    instancePath: instancePath + '/officer/birth/place',
                    schemaPath: '#/properties/officer/properties/birth/properties/place/minLength',
                    keyword: 'minLength',
                    params: { limit: 2 },
                    message: 'must NOT have fewer than 2 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err51];
                  } else {
                    vErrors.push(err51);
                  }
                  errors++;
                }
              } else {
                const err52 = {
                  instancePath: instancePath + '/officer/birth/place',
                  schemaPath: '#/properties/officer/properties/birth/properties/place/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err52];
                } else {
                  vErrors.push(err52);
                }
                errors++;
              }
            }
          } else {
            const err53 = {
              instancePath: instancePath + '/officer/birth',
              schemaPath: '#/properties/officer/properties/birth/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err53];
            } else {
              vErrors.push(err53);
            }
            errors++;
          }
        }
        if (data7.maritalStatus !== undefined) {
          let data15 = data7.maritalStatus;
          if (typeof data15 !== 'string') {
            const err54 = {
              instancePath: instancePath + '/officer/maritalStatus',
              schemaPath: '#/properties/officer/properties/maritalStatus/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err54];
            } else {
              vErrors.push(err54);
            }
            errors++;
          }
          if (!(
            data15 === 'single' ||
            data15 === 'married' ||
            data15 === 'separated' ||
            data15 === 'divorced' ||
            data15 === 'widowed'
          )) {
            const err55 = {
              instancePath: instancePath + '/officer/maritalStatus',
              schemaPath: '#/properties/officer/properties/maritalStatus/enum',
              keyword: 'enum',
              params: { allowedValues: schema31.properties.officer.properties.maritalStatus.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err55];
            } else {
              vErrors.push(err55);
            }
            errors++;
          }
        }
        if (data7.maritalStatusChange !== undefined) {
          let data16 = data7.maritalStatusChange;
          const _errs41 = errors;
          let valid7 = true;
          const _errs42 = errors;
          if (data16 && typeof data16 == 'object' && !Array.isArray(data16)) {
            if (data16.changed !== undefined) {
              if (true !== data16.changed) {
                const err56 = {};
                if (vErrors === null) {
                  vErrors = [err56];
                } else {
                  vErrors.push(err56);
                }
                errors++;
              }
            }
          }
          var _valid0 = _errs42 === errors;
          errors = _errs41;
          if (vErrors !== null) {
            if (_errs41) {
              vErrors.length = _errs41;
            } else {
              vErrors = null;
            }
          }
          if (_valid0) {
            const _errs44 = errors;
            if (data16 && typeof data16 == 'object' && !Array.isArray(data16)) {
              if (data16.changed === undefined) {
                const err57 = {
                  instancePath: instancePath + '/officer/maritalStatusChange',
                  schemaPath: '#/$defs/MaritalStatusChange/then/required',
                  keyword: 'required',
                  params: { missingProperty: 'changed' },
                  message: "must have required property '" + 'changed' + "'",
                };
                if (vErrors === null) {
                  vErrors = [err57];
                } else {
                  vErrors.push(err57);
                }
                errors++;
              }
              if (data16.explanation === undefined) {
                const err58 = {
                  instancePath: instancePath + '/officer/maritalStatusChange',
                  schemaPath: '#/$defs/MaritalStatusChange/then/required',
                  keyword: 'required',
                  params: { missingProperty: 'explanation' },
                  message: "must have required property '" + 'explanation' + "'",
                };
                if (vErrors === null) {
                  vErrors = [err58];
                } else {
                  vErrors.push(err58);
                }
                errors++;
              }
            }
            var _valid0 = _errs44 === errors;
            valid7 = _valid0;
          }
          if (!valid7) {
            const err59 = {
              instancePath: instancePath + '/officer/maritalStatusChange',
              schemaPath: '#/$defs/MaritalStatusChange/if',
              keyword: 'if',
              params: { failingKeyword: 'then' },
              message: 'must match "then" schema',
            };
            if (vErrors === null) {
              vErrors = [err59];
            } else {
              vErrors.push(err59);
            }
            errors++;
          }
          if (data16 && typeof data16 == 'object' && !Array.isArray(data16)) {
            if (data16.changed === undefined) {
              const err60 = {
                instancePath: instancePath + '/officer/maritalStatusChange',
                schemaPath: '#/$defs/MaritalStatusChange/required',
                keyword: 'required',
                params: { missingProperty: 'changed' },
                message: "must have required property '" + 'changed' + "'",
              };
              if (vErrors === null) {
                vErrors = [err60];
              } else {
                vErrors.push(err60);
              }
              errors++;
            }
            for (const key5 in data16) {
              if (!(key5 === 'changed' || key5 === 'explanation')) {
                const err61 = {
                  instancePath: instancePath + '/officer/maritalStatusChange',
                  schemaPath: '#/$defs/MaritalStatusChange/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key5 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err61];
                } else {
                  vErrors.push(err61);
                }
                errors++;
              }
            }
            if (data16.changed !== undefined) {
              if (typeof data16.changed !== 'boolean') {
                const err62 = {
                  instancePath: instancePath + '/officer/maritalStatusChange/changed',
                  schemaPath: '#/$defs/MaritalStatusChange/properties/changed/type',
                  keyword: 'type',
                  params: { type: 'boolean' },
                  message: 'must be boolean',
                };
                if (vErrors === null) {
                  vErrors = [err62];
                } else {
                  vErrors.push(err62);
                }
                errors++;
              }
            }
            if (data16.explanation !== undefined) {
              let data19 = data16.explanation;
              if (typeof data19 === 'string') {
                if (func2(data19) > 1000) {
                  const err63 = {
                    instancePath: instancePath + '/officer/maritalStatusChange/explanation',
                    schemaPath: '#/$defs/MaritalStatusChange/properties/explanation/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 1000 },
                    message: 'must NOT have more than 1000 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err63];
                  } else {
                    vErrors.push(err63);
                  }
                  errors++;
                }
                if (func2(data19) < 1) {
                  const err64 = {
                    instancePath: instancePath + '/officer/maritalStatusChange/explanation',
                    schemaPath: '#/$defs/MaritalStatusChange/properties/explanation/minLength',
                    keyword: 'minLength',
                    params: { limit: 1 },
                    message: 'must NOT have fewer than 1 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err64];
                  } else {
                    vErrors.push(err64);
                  }
                  errors++;
                }
              } else {
                const err65 = {
                  instancePath: instancePath + '/officer/maritalStatusChange/explanation',
                  schemaPath: '#/$defs/MaritalStatusChange/properties/explanation/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err65];
                } else {
                  vErrors.push(err65);
                }
                errors++;
              }
            }
          } else {
            const err66 = {
              instancePath: instancePath + '/officer/maritalStatusChange',
              schemaPath: '#/$defs/MaritalStatusChange/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err66];
            } else {
              vErrors.push(err66);
            }
            errors++;
          }
        }
        if (data7.address !== undefined) {
          let data20 = data7.address;
          if (data20 && typeof data20 == 'object' && !Array.isArray(data20)) {
            if (data20.postal === undefined) {
              const err67 = {
                instancePath: instancePath + '/officer/address',
                schemaPath: '#/properties/officer/properties/address/required',
                keyword: 'required',
                params: { missingProperty: 'postal' },
                message: "must have required property '" + 'postal' + "'",
              };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
            if (data20.physical === undefined) {
              const err68 = {
                instancePath: instancePath + '/officer/address',
                schemaPath: '#/properties/officer/properties/address/required',
                keyword: 'required',
                params: { missingProperty: 'physical' },
                message: "must have required property '" + 'physical' + "'",
              };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
            }
            for (const key6 in data20) {
              if (!(key6 === 'postal' || key6 === 'physical')) {
                const err69 = {
                  instancePath: instancePath + '/officer/address',
                  schemaPath: '#/properties/officer/properties/address/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key6 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err69];
                } else {
                  vErrors.push(err69);
                }
                errors++;
              }
            }
            if (data20.postal !== undefined) {
              let data21 = data20.postal;
              if (typeof data21 === 'string') {
                if (func2(data21) > 200) {
                  const err70 = {
                    instancePath: instancePath + '/officer/address/postal',
                    schemaPath:
                      '#/properties/officer/properties/address/properties/postal/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 200 },
                    message: 'must NOT have more than 200 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err70];
                  } else {
                    vErrors.push(err70);
                  }
                  errors++;
                }
                if (func2(data21) < 3) {
                  const err71 = {
                    instancePath: instancePath + '/officer/address/postal',
                    schemaPath:
                      '#/properties/officer/properties/address/properties/postal/minLength',
                    keyword: 'minLength',
                    params: { limit: 3 },
                    message: 'must NOT have fewer than 3 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err71];
                  } else {
                    vErrors.push(err71);
                  }
                  errors++;
                }
              } else {
                const err72 = {
                  instancePath: instancePath + '/officer/address/postal',
                  schemaPath: '#/properties/officer/properties/address/properties/postal/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err72];
                } else {
                  vErrors.push(err72);
                }
                errors++;
              }
            }
            if (data20.physical !== undefined) {
              let data22 = data20.physical;
              if (typeof data22 === 'string') {
                if (func2(data22) > 200) {
                  const err73 = {
                    instancePath: instancePath + '/officer/address/physical',
                    schemaPath:
                      '#/properties/officer/properties/address/properties/physical/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 200 },
                    message: 'must NOT have more than 200 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err73];
                  } else {
                    vErrors.push(err73);
                  }
                  errors++;
                }
                if (func2(data22) < 3) {
                  const err74 = {
                    instancePath: instancePath + '/officer/address/physical',
                    schemaPath:
                      '#/properties/officer/properties/address/properties/physical/minLength',
                    keyword: 'minLength',
                    params: { limit: 3 },
                    message: 'must NOT have fewer than 3 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err74];
                  } else {
                    vErrors.push(err74);
                  }
                  errors++;
                }
              } else {
                const err75 = {
                  instancePath: instancePath + '/officer/address/physical',
                  schemaPath: '#/properties/officer/properties/address/properties/physical/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err75];
                } else {
                  vErrors.push(err75);
                }
                errors++;
              }
            }
          } else {
            const err76 = {
              instancePath: instancePath + '/officer/address',
              schemaPath: '#/properties/officer/properties/address/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err76];
            } else {
              vErrors.push(err76);
            }
            errors++;
          }
        }
        if (data7.employment !== undefined) {
          let data23 = data7.employment;
          if (data23 && typeof data23 == 'object' && !Array.isArray(data23)) {
            if (data23.designation === undefined) {
              const err77 = {
                instancePath: instancePath + '/officer/employment',
                schemaPath: '#/properties/officer/properties/employment/required',
                keyword: 'required',
                params: { missingProperty: 'designation' },
                message: "must have required property '" + 'designation' + "'",
              };
              if (vErrors === null) {
                vErrors = [err77];
              } else {
                vErrors.push(err77);
              }
              errors++;
            }
            if (data23.employer === undefined) {
              const err78 = {
                instancePath: instancePath + '/officer/employment',
                schemaPath: '#/properties/officer/properties/employment/required',
                keyword: 'required',
                params: { missingProperty: 'employer' },
                message: "must have required property '" + 'employer' + "'",
              };
              if (vErrors === null) {
                vErrors = [err78];
              } else {
                vErrors.push(err78);
              }
              errors++;
            }
            if (data23.nature === undefined) {
              const err79 = {
                instancePath: instancePath + '/officer/employment',
                schemaPath: '#/properties/officer/properties/employment/required',
                keyword: 'required',
                params: { missingProperty: 'nature' },
                message: "must have required property '" + 'nature' + "'",
              };
              if (vErrors === null) {
                vErrors = [err79];
              } else {
                vErrors.push(err79);
              }
              errors++;
            }
            if (data23.responsibleCommission === undefined) {
              const err80 = {
                instancePath: instancePath + '/officer/employment',
                schemaPath: '#/properties/officer/properties/employment/required',
                keyword: 'required',
                params: { missingProperty: 'responsibleCommission' },
                message: "must have required property '" + 'responsibleCommission' + "'",
              };
              if (vErrors === null) {
                vErrors = [err80];
              } else {
                vErrors.push(err80);
              }
              errors++;
            }
            for (const key7 in data23) {
              if (!func1.call(schema31.properties.officer.properties.employment.properties, key7)) {
                const err81 = {
                  instancePath: instancePath + '/officer/employment',
                  schemaPath: '#/properties/officer/properties/employment/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key7 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err81];
                } else {
                  vErrors.push(err81);
                }
                errors++;
              }
            }
            if (data23.designation !== undefined) {
              let data24 = data23.designation;
              if (typeof data24 === 'string') {
                if (func2(data24) > 100) {
                  const err82 = {
                    instancePath: instancePath + '/officer/employment/designation',
                    schemaPath:
                      '#/properties/officer/properties/employment/properties/designation/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err82];
                  } else {
                    vErrors.push(err82);
                  }
                  errors++;
                }
              } else {
                const err83 = {
                  instancePath: instancePath + '/officer/employment/designation',
                  schemaPath:
                    '#/properties/officer/properties/employment/properties/designation/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err83];
                } else {
                  vErrors.push(err83);
                }
                errors++;
              }
            }
            if (data23.employer !== undefined) {
              let data25 = data23.employer;
              if (typeof data25 === 'string') {
                if (func2(data25) > 200) {
                  const err84 = {
                    instancePath: instancePath + '/officer/employment/employer',
                    schemaPath:
                      '#/properties/officer/properties/employment/properties/employer/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 200 },
                    message: 'must NOT have more than 200 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err84];
                  } else {
                    vErrors.push(err84);
                  }
                  errors++;
                }
              } else {
                const err85 = {
                  instancePath: instancePath + '/officer/employment/employer',
                  schemaPath: '#/properties/officer/properties/employment/properties/employer/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err85];
                } else {
                  vErrors.push(err85);
                }
                errors++;
              }
            }
            if (data23.nature !== undefined) {
              let data26 = data23.nature;
              if (typeof data26 !== 'string') {
                const err86 = {
                  instancePath: instancePath + '/officer/employment/nature',
                  schemaPath: '#/properties/officer/properties/employment/properties/nature/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err86];
                } else {
                  vErrors.push(err86);
                }
                errors++;
              }
              if (!(
                data26 === 'permanent' ||
                data26 === 'temporary' ||
                data26 === 'contract' ||
                data26 === 'other'
              )) {
                const err87 = {
                  instancePath: instancePath + '/officer/employment/nature',
                  schemaPath: '#/properties/officer/properties/employment/properties/nature/enum',
                  keyword: 'enum',
                  params: {
                    allowedValues:
                      schema31.properties.officer.properties.employment.properties.nature.enum,
                  },
                  message: 'must be equal to one of the allowed values',
                };
                if (vErrors === null) {
                  vErrors = [err87];
                } else {
                  vErrors.push(err87);
                }
                errors++;
              }
            }
            if (data23.natureOther !== undefined) {
              let data27 = data23.natureOther;
              if (typeof data27 === 'string') {
                if (func2(data27) > 100) {
                  const err88 = {
                    instancePath: instancePath + '/officer/employment/natureOther',
                    schemaPath:
                      '#/properties/officer/properties/employment/properties/natureOther/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err88];
                  } else {
                    vErrors.push(err88);
                  }
                  errors++;
                }
              } else {
                const err89 = {
                  instancePath: instancePath + '/officer/employment/natureOther',
                  schemaPath:
                    '#/properties/officer/properties/employment/properties/natureOther/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err89];
                } else {
                  vErrors.push(err89);
                }
                errors++;
              }
            }
            if (data23.responsibleCommission !== undefined) {
              let data28 = data23.responsibleCommission;
              if (typeof data28 === 'string') {
                if (!pattern4.test(data28)) {
                  const err90 = {
                    instancePath: instancePath + '/officer/employment/responsibleCommission',
                    schemaPath:
                      '#/properties/officer/properties/employment/properties/responsibleCommission/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^[a-z][a-z0-9]{1,19}$' },
                    message: 'must match pattern "' + '^[a-z][a-z0-9]{1,19}$' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err90];
                  } else {
                    vErrors.push(err90);
                  }
                  errors++;
                }
              } else {
                const err91 = {
                  instancePath: instancePath + '/officer/employment/responsibleCommission',
                  schemaPath:
                    '#/properties/officer/properties/employment/properties/responsibleCommission/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err91];
                } else {
                  vErrors.push(err91);
                }
                errors++;
              }
            }
            if (data23.personnelFileNumber !== undefined) {
              let data29 = data23.personnelFileNumber;
              if (typeof data29 === 'string') {
                if (func2(data29) > 30) {
                  const err92 = {
                    instancePath: instancePath + '/officer/employment/personnelFileNumber',
                    schemaPath:
                      '#/properties/officer/properties/employment/properties/personnelFileNumber/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 30 },
                    message: 'must NOT have more than 30 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err92];
                  } else {
                    vErrors.push(err92);
                  }
                  errors++;
                }
              } else {
                const err93 = {
                  instancePath: instancePath + '/officer/employment/personnelFileNumber',
                  schemaPath:
                    '#/properties/officer/properties/employment/properties/personnelFileNumber/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err93];
                } else {
                  vErrors.push(err93);
                }
                errors++;
              }
            }
            if (data23.jobGroup !== undefined) {
              let data30 = data23.jobGroup;
              if (typeof data30 === 'string') {
                if (func2(data30) > 40) {
                  const err94 = {
                    instancePath: instancePath + '/officer/employment/jobGroup',
                    schemaPath:
                      '#/properties/officer/properties/employment/properties/jobGroup/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 40 },
                    message: 'must NOT have more than 40 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err94];
                  } else {
                    vErrors.push(err94);
                  }
                  errors++;
                }
              } else {
                const err95 = {
                  instancePath: instancePath + '/officer/employment/jobGroup',
                  schemaPath: '#/properties/officer/properties/employment/properties/jobGroup/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err95];
                } else {
                  vErrors.push(err95);
                }
                errors++;
              }
            }
            if (data23.appointmentDate !== undefined) {
              let data31 = data23.appointmentDate;
              if (typeof data31 === 'string') {
                if (!formats0.validate(data31)) {
                  const err96 = {
                    instancePath: instancePath + '/officer/employment/appointmentDate',
                    schemaPath:
                      '#/properties/officer/properties/employment/properties/appointmentDate/format',
                    keyword: 'format',
                    params: { format: 'date' },
                    message: 'must match format "' + 'date' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err96];
                  } else {
                    vErrors.push(err96);
                  }
                  errors++;
                }
              } else {
                const err97 = {
                  instancePath: instancePath + '/officer/employment/appointmentDate',
                  schemaPath:
                    '#/properties/officer/properties/employment/properties/appointmentDate/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err97];
                } else {
                  vErrors.push(err97);
                }
                errors++;
              }
            }
            if (data23.workStation !== undefined) {
              let data32 = data23.workStation;
              if (typeof data32 === 'string') {
                if (func2(data32) > 100) {
                  const err98 = {
                    instancePath: instancePath + '/officer/employment/workStation',
                    schemaPath:
                      '#/properties/officer/properties/employment/properties/workStation/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err98];
                  } else {
                    vErrors.push(err98);
                  }
                  errors++;
                }
              } else {
                const err99 = {
                  instancePath: instancePath + '/officer/employment/workStation',
                  schemaPath:
                    '#/properties/officer/properties/employment/properties/workStation/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err99];
                } else {
                  vErrors.push(err99);
                }
                errors++;
              }
            }
          } else {
            const err100 = {
              instancePath: instancePath + '/officer/employment',
              schemaPath: '#/properties/officer/properties/employment/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err100];
            } else {
              vErrors.push(err100);
            }
            errors++;
          }
        }
      } else {
        const err101 = {
          instancePath: instancePath + '/officer',
          schemaPath: '#/properties/officer/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err101];
        } else {
          vErrors.push(err101);
        }
        errors++;
      }
    }
    if (data.spouses !== undefined) {
      let data33 = data.spouses;
      if (data33 && typeof data33 == 'object' && !Array.isArray(data33)) {
        if (data33.none === undefined) {
          const err102 = {
            instancePath: instancePath + '/spouses',
            schemaPath: '#/properties/spouses/required',
            keyword: 'required',
            params: { missingProperty: 'none' },
            message: "must have required property '" + 'none' + "'",
          };
          if (vErrors === null) {
            vErrors = [err102];
          } else {
            vErrors.push(err102);
          }
          errors++;
        }
        if (data33.items === undefined) {
          const err103 = {
            instancePath: instancePath + '/spouses',
            schemaPath: '#/properties/spouses/required',
            keyword: 'required',
            params: { missingProperty: 'items' },
            message: "must have required property '" + 'items' + "'",
          };
          if (vErrors === null) {
            vErrors = [err103];
          } else {
            vErrors.push(err103);
          }
          errors++;
        }
        for (const key8 in data33) {
          if (!(key8 === 'none' || key8 === 'items')) {
            const err104 = {
              instancePath: instancePath + '/spouses',
              schemaPath: '#/properties/spouses/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key8 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err104];
            } else {
              vErrors.push(err104);
            }
            errors++;
          }
        }
        if (data33.none !== undefined) {
          if (typeof data33.none !== 'boolean') {
            const err105 = {
              instancePath: instancePath + '/spouses/none',
              schemaPath: '#/properties/spouses/properties/none/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err105];
            } else {
              vErrors.push(err105);
            }
            errors++;
          }
        }
        if (data33.items !== undefined) {
          let data35 = data33.items;
          if (Array.isArray(data35)) {
            const len0 = data35.length;
            for (let i0 = 0; i0 < len0; i0++) {
              if (
                !validate21(data35[i0], {
                  instancePath: instancePath + '/spouses/items/' + i0,
                  parentData: data35,
                  parentDataProperty: i0,
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
                errors = vErrors.length;
              }
            }
          } else {
            const err106 = {
              instancePath: instancePath + '/spouses/items',
              schemaPath: '#/properties/spouses/properties/items/type',
              keyword: 'type',
              params: { type: 'array' },
              message: 'must be array',
            };
            if (vErrors === null) {
              vErrors = [err106];
            } else {
              vErrors.push(err106);
            }
            errors++;
          }
        }
      } else {
        const err107 = {
          instancePath: instancePath + '/spouses',
          schemaPath: '#/properties/spouses/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err107];
        } else {
          vErrors.push(err107);
        }
        errors++;
      }
    }
    if (data.children !== undefined) {
      let data37 = data.children;
      if (data37 && typeof data37 == 'object' && !Array.isArray(data37)) {
        if (data37.none === undefined) {
          const err108 = {
            instancePath: instancePath + '/children',
            schemaPath: '#/properties/children/required',
            keyword: 'required',
            params: { missingProperty: 'none' },
            message: "must have required property '" + 'none' + "'",
          };
          if (vErrors === null) {
            vErrors = [err108];
          } else {
            vErrors.push(err108);
          }
          errors++;
        }
        if (data37.items === undefined) {
          const err109 = {
            instancePath: instancePath + '/children',
            schemaPath: '#/properties/children/required',
            keyword: 'required',
            params: { missingProperty: 'items' },
            message: "must have required property '" + 'items' + "'",
          };
          if (vErrors === null) {
            vErrors = [err109];
          } else {
            vErrors.push(err109);
          }
          errors++;
        }
        for (const key9 in data37) {
          if (!(key9 === 'none' || key9 === 'items')) {
            const err110 = {
              instancePath: instancePath + '/children',
              schemaPath: '#/properties/children/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key9 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err110];
            } else {
              vErrors.push(err110);
            }
            errors++;
          }
        }
        if (data37.none !== undefined) {
          if (typeof data37.none !== 'boolean') {
            const err111 = {
              instancePath: instancePath + '/children/none',
              schemaPath: '#/properties/children/properties/none/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err111];
            } else {
              vErrors.push(err111);
            }
            errors++;
          }
        }
        if (data37.items !== undefined) {
          let data39 = data37.items;
          if (Array.isArray(data39)) {
            const len1 = data39.length;
            for (let i1 = 0; i1 < len1; i1++) {
              if (
                !validate23(data39[i1], {
                  instancePath: instancePath + '/children/items/' + i1,
                  parentData: data39,
                  parentDataProperty: i1,
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate23.errors : vErrors.concat(validate23.errors);
                errors = vErrors.length;
              }
            }
          } else {
            const err112 = {
              instancePath: instancePath + '/children/items',
              schemaPath: '#/properties/children/properties/items/type',
              keyword: 'type',
              params: { type: 'array' },
              message: 'must be array',
            };
            if (vErrors === null) {
              vErrors = [err112];
            } else {
              vErrors.push(err112);
            }
            errors++;
          }
        }
      } else {
        const err113 = {
          instancePath: instancePath + '/children',
          schemaPath: '#/properties/children/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err113];
        } else {
          vErrors.push(err113);
        }
        errors++;
      }
    }
    if (data.statements !== undefined) {
      let data41 = data.statements;
      if (Array.isArray(data41)) {
        if (data41.length < 1) {
          const err114 = {
            instancePath: instancePath + '/statements',
            schemaPath: '#/properties/statements/minItems',
            keyword: 'minItems',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 items',
          };
          if (vErrors === null) {
            vErrors = [err114];
          } else {
            vErrors.push(err114);
          }
          errors++;
        }
        const len2 = data41.length;
        for (let i2 = 0; i2 < len2; i2++) {
          if (
            !validate25(data41[i2], {
              instancePath: instancePath + '/statements/' + i2,
              parentData: data41,
              parentDataProperty: i2,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err115 = {
          instancePath: instancePath + '/statements',
          schemaPath: '#/properties/statements/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err115];
        } else {
          vErrors.push(err115);
        }
        errors++;
      }
    }
    if (data.otherInformation !== undefined) {
      let data43 = data.otherInformation;
      if (data43 && typeof data43 == 'object' && !Array.isArray(data43)) {
        if (data43.materialChanges === undefined) {
          const err116 = {
            instancePath: instancePath + '/otherInformation',
            schemaPath: '#/properties/otherInformation/required',
            keyword: 'required',
            params: { missingProperty: 'materialChanges' },
            message: "must have required property '" + 'materialChanges' + "'",
          };
          if (vErrors === null) {
            vErrors = [err116];
          } else {
            vErrors.push(err116);
          }
          errors++;
        }
        if (data43.registrableInterests === undefined) {
          const err117 = {
            instancePath: instancePath + '/otherInformation',
            schemaPath: '#/properties/otherInformation/required',
            keyword: 'required',
            params: { missingProperty: 'registrableInterests' },
            message: "must have required property '" + 'registrableInterests' + "'",
          };
          if (vErrors === null) {
            vErrors = [err117];
          } else {
            vErrors.push(err117);
          }
          errors++;
        }
        if (data43.freeText === undefined) {
          const err118 = {
            instancePath: instancePath + '/otherInformation',
            schemaPath: '#/properties/otherInformation/required',
            keyword: 'required',
            params: { missingProperty: 'freeText' },
            message: "must have required property '" + 'freeText' + "'",
          };
          if (vErrors === null) {
            vErrors = [err118];
          } else {
            vErrors.push(err118);
          }
          errors++;
        }
        for (const key10 in data43) {
          if (!(
            key10 === 'materialChanges' ||
            key10 === 'registrableInterests' ||
            key10 === 'freeText'
          )) {
            const err119 = {
              instancePath: instancePath + '/otherInformation',
              schemaPath: '#/properties/otherInformation/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key10 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err119];
            } else {
              vErrors.push(err119);
            }
            errors++;
          }
        }
        if (data43.materialChanges !== undefined) {
          let data44 = data43.materialChanges;
          if (Array.isArray(data44)) {
            const len3 = data44.length;
            for (let i3 = 0; i3 < len3; i3++) {
              if (
                !validate33(data44[i3], {
                  instancePath: instancePath + '/otherInformation/materialChanges/' + i3,
                  parentData: data44,
                  parentDataProperty: i3,
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate33.errors : vErrors.concat(validate33.errors);
                errors = vErrors.length;
              }
            }
          } else {
            const err120 = {
              instancePath: instancePath + '/otherInformation/materialChanges',
              schemaPath: '#/properties/otherInformation/properties/materialChanges/type',
              keyword: 'type',
              params: { type: 'array' },
              message: 'must be array',
            };
            if (vErrors === null) {
              vErrors = [err120];
            } else {
              vErrors.push(err120);
            }
            errors++;
          }
        }
        if (data43.registrableInterests !== undefined) {
          if (
            !validate35(data43.registrableInterests, {
              instancePath: instancePath + '/otherInformation/registrableInterests',
              parentData: data43,
              parentDataProperty: 'registrableInterests',
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate35.errors : vErrors.concat(validate35.errors);
            errors = vErrors.length;
          }
        }
        if (data43.freeText !== undefined) {
          let data47 = data43.freeText;
          if (typeof data47 === 'string') {
            if (func2(data47) > 4000) {
              const err121 = {
                instancePath: instancePath + '/otherInformation/freeText',
                schemaPath: '#/properties/otherInformation/properties/freeText/maxLength',
                keyword: 'maxLength',
                params: { limit: 4000 },
                message: 'must NOT have more than 4000 characters',
              };
              if (vErrors === null) {
                vErrors = [err121];
              } else {
                vErrors.push(err121);
              }
              errors++;
            }
          } else {
            const err122 = {
              instancePath: instancePath + '/otherInformation/freeText',
              schemaPath: '#/properties/otherInformation/properties/freeText/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err122];
            } else {
              vErrors.push(err122);
            }
            errors++;
          }
        }
      } else {
        const err123 = {
          instancePath: instancePath + '/otherInformation',
          schemaPath: '#/properties/otherInformation/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err123];
        } else {
          vErrors.push(err123);
        }
        errors++;
      }
    }
    if (data.attestation !== undefined) {
      let data48 = data.attestation;
      if (data48 && typeof data48 == 'object' && !Array.isArray(data48)) {
        if (data48.text === undefined) {
          const err124 = {
            instancePath: instancePath + '/attestation',
            schemaPath: '#/properties/attestation/required',
            keyword: 'required',
            params: { missingProperty: 'text' },
            message: "must have required property '" + 'text' + "'",
          };
          if (vErrors === null) {
            vErrors = [err124];
          } else {
            vErrors.push(err124);
          }
          errors++;
        }
        for (const key11 in data48) {
          if (!(key11 === 'text' || key11 === 'declaredAt' || key11 === 'reference')) {
            const err125 = {
              instancePath: instancePath + '/attestation',
              schemaPath: '#/properties/attestation/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key11 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err125];
            } else {
              vErrors.push(err125);
            }
            errors++;
          }
        }
        if (data48.text !== undefined) {
          if (
            'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.' !==
            data48.text
          ) {
            const err126 = {
              instancePath: instancePath + '/attestation/text',
              schemaPath: '#/properties/attestation/properties/text/const',
              keyword: 'const',
              params: {
                allowedValue:
                  'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.',
              },
              message: 'must be equal to constant',
            };
            if (vErrors === null) {
              vErrors = [err126];
            } else {
              vErrors.push(err126);
            }
            errors++;
          }
        }
        if (data48.declaredAt !== undefined) {
          let data50 = data48.declaredAt;
          if (typeof data50 === 'string') {
            if (!formats32.validate(data50)) {
              const err127 = {
                instancePath: instancePath + '/attestation/declaredAt',
                schemaPath: '#/properties/attestation/properties/declaredAt/format',
                keyword: 'format',
                params: { format: 'date-time' },
                message: 'must match format "' + 'date-time' + '"',
              };
              if (vErrors === null) {
                vErrors = [err127];
              } else {
                vErrors.push(err127);
              }
              errors++;
            }
          } else {
            const err128 = {
              instancePath: instancePath + '/attestation/declaredAt',
              schemaPath: '#/properties/attestation/properties/declaredAt/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err128];
            } else {
              vErrors.push(err128);
            }
            errors++;
          }
        }
        if (data48.reference !== undefined) {
          if (typeof data48.reference !== 'string') {
            const err129 = {
              instancePath: instancePath + '/attestation/reference',
              schemaPath: '#/properties/attestation/properties/reference/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err129];
            } else {
              vErrors.push(err129);
            }
            errors++;
          }
        }
      } else {
        const err130 = {
          instancePath: instancePath + '/attestation',
          schemaPath: '#/properties/attestation/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err130];
        } else {
          vErrors.push(err130);
        }
        errors++;
      }
    }
  } else {
    const err131 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err131];
    } else {
      vErrors.push(err131);
    }
    errors++;
  }
  validate20.errors = vErrors;
  return errors === 0;
}
validate20.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export const bioSection = validate37;
const schema65 = { $ref: 'https://adili.go.ke/schemas/declaration.v1.json#/properties/officer' };
const schema66 = {
  type: 'object',
  description: 'Paragraphs 1-5',
  required: ['name', 'birth', 'maritalStatus', 'address', 'employment'],
  additionalProperties: false,
  properties: {
    name: { $ref: '#/$defs/PersonName' },
    birth: {
      type: 'object',
      required: ['date', 'place'],
      additionalProperties: false,
      properties: {
        date: { type: 'string', format: 'date' },
        place: { type: 'string', minLength: 2, maxLength: 100 },
      },
    },
    maritalStatus: {
      type: 'string',
      enum: ['single', 'married', 'separated', 'divorced', 'widowed'],
    },
    maritalStatusChange: { $ref: '#/$defs/MaritalStatusChange' },
    address: {
      type: 'object',
      required: ['postal', 'physical'],
      additionalProperties: false,
      properties: {
        postal: { type: 'string', minLength: 3, maxLength: 200 },
        physical: { type: 'string', minLength: 3, maxLength: 200 },
      },
    },
    employment: {
      type: 'object',
      required: ['designation', 'employer', 'nature', 'responsibleCommission'],
      additionalProperties: false,
      properties: {
        designation: { type: 'string', maxLength: 100 },
        employer: { type: 'string', maxLength: 200 },
        nature: { type: 'string', enum: ['permanent', 'temporary', 'contract', 'other'] },
        natureOther: { type: 'string', maxLength: 100 },
        responsibleCommission: {
          type: 'string',
          description: 'Tenant key of the Responsible Commission',
          pattern: '^[a-z][a-z0-9]{1,19}$',
        },
        personnelFileNumber: { type: 'string', maxLength: 30 },
        jobGroup: {
          type: 'string',
          maxLength: 40,
          description:
            "Pre-filled from the Commission's roster when it has one (spec 05b); editable",
        },
        appointmentDate: {
          type: 'string',
          format: 'date',
          description:
            "Date of appointment; pre-filled from the Commission's roster when it has one (spec 05b); editable",
        },
        workStation: {
          type: 'string',
          maxLength: 100,
          description:
            "Pre-filled from the Commission's roster when it has one (spec 05b); editable",
        },
      },
    },
  },
};
function validate38(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate38.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.name === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'name' },
        message: "must have required property '" + 'name' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.birth === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'birth' },
        message: "must have required property '" + 'birth' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.maritalStatus === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'maritalStatus' },
        message: "must have required property '" + 'maritalStatus' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.address === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'address' },
        message: "must have required property '" + 'address' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.employment === undefined) {
      const err4 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'employment' },
        message: "must have required property '" + 'employment' + "'",
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(
        key0 === 'name' ||
        key0 === 'birth' ||
        key0 === 'maritalStatus' ||
        key0 === 'maritalStatusChange' ||
        key0 === 'address' ||
        key0 === 'employment'
      )) {
        const err5 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.name !== undefined) {
      let data0 = data.name;
      if (data0 && typeof data0 == 'object' && !Array.isArray(data0)) {
        if (data0.surname === undefined) {
          const err6 = {
            instancePath: instancePath + '/name',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'surname' },
            message: "must have required property '" + 'surname' + "'",
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data0.firstName === undefined) {
          const err7 = {
            instancePath: instancePath + '/name',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'firstName' },
            message: "must have required property '" + 'firstName' + "'",
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        for (const key1 in data0) {
          if (!(key1 === 'surname' || key1 === 'firstName' || key1 === 'otherNames')) {
            const err8 = {
              instancePath: instancePath + '/name',
              schemaPath: '#/$defs/PersonName/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
        if (data0.surname !== undefined) {
          let data1 = data0.surname;
          if (typeof data1 === 'string') {
            if (func2(data1) > 100) {
              const err9 = {
                instancePath: instancePath + '/name/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err9];
              } else {
                vErrors.push(err9);
              }
              errors++;
            }
            if (func2(data1) < 1) {
              const err10 = {
                instancePath: instancePath + '/name/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
          } else {
            const err11 = {
              instancePath: instancePath + '/name/surname',
              schemaPath: '#/$defs/PersonName/properties/surname/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        }
        if (data0.firstName !== undefined) {
          let data2 = data0.firstName;
          if (typeof data2 === 'string') {
            if (func2(data2) > 100) {
              const err12 = {
                instancePath: instancePath + '/name/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err12];
              } else {
                vErrors.push(err12);
              }
              errors++;
            }
            if (func2(data2) < 1) {
              const err13 = {
                instancePath: instancePath + '/name/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
          } else {
            const err14 = {
              instancePath: instancePath + '/name/firstName',
              schemaPath: '#/$defs/PersonName/properties/firstName/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
        }
        if (data0.otherNames !== undefined) {
          let data3 = data0.otherNames;
          if (typeof data3 === 'string') {
            if (func2(data3) > 200) {
              const err15 = {
                instancePath: instancePath + '/name/otherNames',
                schemaPath: '#/$defs/PersonName/properties/otherNames/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
          } else {
            const err16 = {
              instancePath: instancePath + '/name/otherNames',
              schemaPath: '#/$defs/PersonName/properties/otherNames/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        }
      } else {
        const err17 = {
          instancePath: instancePath + '/name',
          schemaPath: '#/$defs/PersonName/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.birth !== undefined) {
      let data4 = data.birth;
      if (data4 && typeof data4 == 'object' && !Array.isArray(data4)) {
        if (data4.date === undefined) {
          const err18 = {
            instancePath: instancePath + '/birth',
            schemaPath: '#/properties/birth/required',
            keyword: 'required',
            params: { missingProperty: 'date' },
            message: "must have required property '" + 'date' + "'",
          };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        if (data4.place === undefined) {
          const err19 = {
            instancePath: instancePath + '/birth',
            schemaPath: '#/properties/birth/required',
            keyword: 'required',
            params: { missingProperty: 'place' },
            message: "must have required property '" + 'place' + "'",
          };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
        for (const key2 in data4) {
          if (!(key2 === 'date' || key2 === 'place')) {
            const err20 = {
              instancePath: instancePath + '/birth',
              schemaPath: '#/properties/birth/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key2 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
        }
        if (data4.date !== undefined) {
          let data5 = data4.date;
          if (typeof data5 === 'string') {
            if (!formats0.validate(data5)) {
              const err21 = {
                instancePath: instancePath + '/birth/date',
                schemaPath: '#/properties/birth/properties/date/format',
                keyword: 'format',
                params: { format: 'date' },
                message: 'must match format "' + 'date' + '"',
              };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          } else {
            const err22 = {
              instancePath: instancePath + '/birth/date',
              schemaPath: '#/properties/birth/properties/date/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
        if (data4.place !== undefined) {
          let data6 = data4.place;
          if (typeof data6 === 'string') {
            if (func2(data6) > 100) {
              const err23 = {
                instancePath: instancePath + '/birth/place',
                schemaPath: '#/properties/birth/properties/place/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err23];
              } else {
                vErrors.push(err23);
              }
              errors++;
            }
            if (func2(data6) < 2) {
              const err24 = {
                instancePath: instancePath + '/birth/place',
                schemaPath: '#/properties/birth/properties/place/minLength',
                keyword: 'minLength',
                params: { limit: 2 },
                message: 'must NOT have fewer than 2 characters',
              };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
          } else {
            const err25 = {
              instancePath: instancePath + '/birth/place',
              schemaPath: '#/properties/birth/properties/place/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err25];
            } else {
              vErrors.push(err25);
            }
            errors++;
          }
        }
      } else {
        const err26 = {
          instancePath: instancePath + '/birth',
          schemaPath: '#/properties/birth/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.maritalStatus !== undefined) {
      let data7 = data.maritalStatus;
      if (typeof data7 !== 'string') {
        const err27 = {
          instancePath: instancePath + '/maritalStatus',
          schemaPath: '#/properties/maritalStatus/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
      if (!(
        data7 === 'single' ||
        data7 === 'married' ||
        data7 === 'separated' ||
        data7 === 'divorced' ||
        data7 === 'widowed'
      )) {
        const err28 = {
          instancePath: instancePath + '/maritalStatus',
          schemaPath: '#/properties/maritalStatus/enum',
          keyword: 'enum',
          params: { allowedValues: schema66.properties.maritalStatus.enum },
          message: 'must be equal to one of the allowed values',
        };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
    }
    if (data.maritalStatusChange !== undefined) {
      let data8 = data.maritalStatusChange;
      const _errs24 = errors;
      let valid5 = true;
      const _errs25 = errors;
      if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
        if (data8.changed !== undefined) {
          if (true !== data8.changed) {
            const err29 = {};
            if (vErrors === null) {
              vErrors = [err29];
            } else {
              vErrors.push(err29);
            }
            errors++;
          }
        }
      }
      var _valid0 = _errs25 === errors;
      errors = _errs24;
      if (vErrors !== null) {
        if (_errs24) {
          vErrors.length = _errs24;
        } else {
          vErrors = null;
        }
      }
      if (_valid0) {
        const _errs27 = errors;
        if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
          if (data8.changed === undefined) {
            const err30 = {
              instancePath: instancePath + '/maritalStatusChange',
              schemaPath: '#/$defs/MaritalStatusChange/then/required',
              keyword: 'required',
              params: { missingProperty: 'changed' },
              message: "must have required property '" + 'changed' + "'",
            };
            if (vErrors === null) {
              vErrors = [err30];
            } else {
              vErrors.push(err30);
            }
            errors++;
          }
          if (data8.explanation === undefined) {
            const err31 = {
              instancePath: instancePath + '/maritalStatusChange',
              schemaPath: '#/$defs/MaritalStatusChange/then/required',
              keyword: 'required',
              params: { missingProperty: 'explanation' },
              message: "must have required property '" + 'explanation' + "'",
            };
            if (vErrors === null) {
              vErrors = [err31];
            } else {
              vErrors.push(err31);
            }
            errors++;
          }
        }
        var _valid0 = _errs27 === errors;
        valid5 = _valid0;
      }
      if (!valid5) {
        const err32 = {
          instancePath: instancePath + '/maritalStatusChange',
          schemaPath: '#/$defs/MaritalStatusChange/if',
          keyword: 'if',
          params: { failingKeyword: 'then' },
          message: 'must match "then" schema',
        };
        if (vErrors === null) {
          vErrors = [err32];
        } else {
          vErrors.push(err32);
        }
        errors++;
      }
      if (data8 && typeof data8 == 'object' && !Array.isArray(data8)) {
        if (data8.changed === undefined) {
          const err33 = {
            instancePath: instancePath + '/maritalStatusChange',
            schemaPath: '#/$defs/MaritalStatusChange/required',
            keyword: 'required',
            params: { missingProperty: 'changed' },
            message: "must have required property '" + 'changed' + "'",
          };
          if (vErrors === null) {
            vErrors = [err33];
          } else {
            vErrors.push(err33);
          }
          errors++;
        }
        for (const key3 in data8) {
          if (!(key3 === 'changed' || key3 === 'explanation')) {
            const err34 = {
              instancePath: instancePath + '/maritalStatusChange',
              schemaPath: '#/$defs/MaritalStatusChange/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key3 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err34];
            } else {
              vErrors.push(err34);
            }
            errors++;
          }
        }
        if (data8.changed !== undefined) {
          if (typeof data8.changed !== 'boolean') {
            const err35 = {
              instancePath: instancePath + '/maritalStatusChange/changed',
              schemaPath: '#/$defs/MaritalStatusChange/properties/changed/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
        if (data8.explanation !== undefined) {
          let data11 = data8.explanation;
          if (typeof data11 === 'string') {
            if (func2(data11) > 1000) {
              const err36 = {
                instancePath: instancePath + '/maritalStatusChange/explanation',
                schemaPath: '#/$defs/MaritalStatusChange/properties/explanation/maxLength',
                keyword: 'maxLength',
                params: { limit: 1000 },
                message: 'must NOT have more than 1000 characters',
              };
              if (vErrors === null) {
                vErrors = [err36];
              } else {
                vErrors.push(err36);
              }
              errors++;
            }
            if (func2(data11) < 1) {
              const err37 = {
                instancePath: instancePath + '/maritalStatusChange/explanation',
                schemaPath: '#/$defs/MaritalStatusChange/properties/explanation/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err37];
              } else {
                vErrors.push(err37);
              }
              errors++;
            }
          } else {
            const err38 = {
              instancePath: instancePath + '/maritalStatusChange/explanation',
              schemaPath: '#/$defs/MaritalStatusChange/properties/explanation/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err38];
            } else {
              vErrors.push(err38);
            }
            errors++;
          }
        }
      } else {
        const err39 = {
          instancePath: instancePath + '/maritalStatusChange',
          schemaPath: '#/$defs/MaritalStatusChange/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.address !== undefined) {
      let data12 = data.address;
      if (data12 && typeof data12 == 'object' && !Array.isArray(data12)) {
        if (data12.postal === undefined) {
          const err40 = {
            instancePath: instancePath + '/address',
            schemaPath: '#/properties/address/required',
            keyword: 'required',
            params: { missingProperty: 'postal' },
            message: "must have required property '" + 'postal' + "'",
          };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        if (data12.physical === undefined) {
          const err41 = {
            instancePath: instancePath + '/address',
            schemaPath: '#/properties/address/required',
            keyword: 'required',
            params: { missingProperty: 'physical' },
            message: "must have required property '" + 'physical' + "'",
          };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
        for (const key4 in data12) {
          if (!(key4 === 'postal' || key4 === 'physical')) {
            const err42 = {
              instancePath: instancePath + '/address',
              schemaPath: '#/properties/address/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key4 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
        }
        if (data12.postal !== undefined) {
          let data13 = data12.postal;
          if (typeof data13 === 'string') {
            if (func2(data13) > 200) {
              const err43 = {
                instancePath: instancePath + '/address/postal',
                schemaPath: '#/properties/address/properties/postal/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err43];
              } else {
                vErrors.push(err43);
              }
              errors++;
            }
            if (func2(data13) < 3) {
              const err44 = {
                instancePath: instancePath + '/address/postal',
                schemaPath: '#/properties/address/properties/postal/minLength',
                keyword: 'minLength',
                params: { limit: 3 },
                message: 'must NOT have fewer than 3 characters',
              };
              if (vErrors === null) {
                vErrors = [err44];
              } else {
                vErrors.push(err44);
              }
              errors++;
            }
          } else {
            const err45 = {
              instancePath: instancePath + '/address/postal',
              schemaPath: '#/properties/address/properties/postal/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
        }
        if (data12.physical !== undefined) {
          let data14 = data12.physical;
          if (typeof data14 === 'string') {
            if (func2(data14) > 200) {
              const err46 = {
                instancePath: instancePath + '/address/physical',
                schemaPath: '#/properties/address/properties/physical/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err46];
              } else {
                vErrors.push(err46);
              }
              errors++;
            }
            if (func2(data14) < 3) {
              const err47 = {
                instancePath: instancePath + '/address/physical',
                schemaPath: '#/properties/address/properties/physical/minLength',
                keyword: 'minLength',
                params: { limit: 3 },
                message: 'must NOT have fewer than 3 characters',
              };
              if (vErrors === null) {
                vErrors = [err47];
              } else {
                vErrors.push(err47);
              }
              errors++;
            }
          } else {
            const err48 = {
              instancePath: instancePath + '/address/physical',
              schemaPath: '#/properties/address/properties/physical/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err48];
            } else {
              vErrors.push(err48);
            }
            errors++;
          }
        }
      } else {
        const err49 = {
          instancePath: instancePath + '/address',
          schemaPath: '#/properties/address/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err49];
        } else {
          vErrors.push(err49);
        }
        errors++;
      }
    }
    if (data.employment !== undefined) {
      let data15 = data.employment;
      if (data15 && typeof data15 == 'object' && !Array.isArray(data15)) {
        if (data15.designation === undefined) {
          const err50 = {
            instancePath: instancePath + '/employment',
            schemaPath: '#/properties/employment/required',
            keyword: 'required',
            params: { missingProperty: 'designation' },
            message: "must have required property '" + 'designation' + "'",
          };
          if (vErrors === null) {
            vErrors = [err50];
          } else {
            vErrors.push(err50);
          }
          errors++;
        }
        if (data15.employer === undefined) {
          const err51 = {
            instancePath: instancePath + '/employment',
            schemaPath: '#/properties/employment/required',
            keyword: 'required',
            params: { missingProperty: 'employer' },
            message: "must have required property '" + 'employer' + "'",
          };
          if (vErrors === null) {
            vErrors = [err51];
          } else {
            vErrors.push(err51);
          }
          errors++;
        }
        if (data15.nature === undefined) {
          const err52 = {
            instancePath: instancePath + '/employment',
            schemaPath: '#/properties/employment/required',
            keyword: 'required',
            params: { missingProperty: 'nature' },
            message: "must have required property '" + 'nature' + "'",
          };
          if (vErrors === null) {
            vErrors = [err52];
          } else {
            vErrors.push(err52);
          }
          errors++;
        }
        if (data15.responsibleCommission === undefined) {
          const err53 = {
            instancePath: instancePath + '/employment',
            schemaPath: '#/properties/employment/required',
            keyword: 'required',
            params: { missingProperty: 'responsibleCommission' },
            message: "must have required property '" + 'responsibleCommission' + "'",
          };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
        for (const key5 in data15) {
          if (!func1.call(schema66.properties.employment.properties, key5)) {
            const err54 = {
              instancePath: instancePath + '/employment',
              schemaPath: '#/properties/employment/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key5 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err54];
            } else {
              vErrors.push(err54);
            }
            errors++;
          }
        }
        if (data15.designation !== undefined) {
          let data16 = data15.designation;
          if (typeof data16 === 'string') {
            if (func2(data16) > 100) {
              const err55 = {
                instancePath: instancePath + '/employment/designation',
                schemaPath: '#/properties/employment/properties/designation/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err55];
              } else {
                vErrors.push(err55);
              }
              errors++;
            }
          } else {
            const err56 = {
              instancePath: instancePath + '/employment/designation',
              schemaPath: '#/properties/employment/properties/designation/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err56];
            } else {
              vErrors.push(err56);
            }
            errors++;
          }
        }
        if (data15.employer !== undefined) {
          let data17 = data15.employer;
          if (typeof data17 === 'string') {
            if (func2(data17) > 200) {
              const err57 = {
                instancePath: instancePath + '/employment/employer',
                schemaPath: '#/properties/employment/properties/employer/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err57];
              } else {
                vErrors.push(err57);
              }
              errors++;
            }
          } else {
            const err58 = {
              instancePath: instancePath + '/employment/employer',
              schemaPath: '#/properties/employment/properties/employer/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err58];
            } else {
              vErrors.push(err58);
            }
            errors++;
          }
        }
        if (data15.nature !== undefined) {
          let data18 = data15.nature;
          if (typeof data18 !== 'string') {
            const err59 = {
              instancePath: instancePath + '/employment/nature',
              schemaPath: '#/properties/employment/properties/nature/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err59];
            } else {
              vErrors.push(err59);
            }
            errors++;
          }
          if (!(
            data18 === 'permanent' ||
            data18 === 'temporary' ||
            data18 === 'contract' ||
            data18 === 'other'
          )) {
            const err60 = {
              instancePath: instancePath + '/employment/nature',
              schemaPath: '#/properties/employment/properties/nature/enum',
              keyword: 'enum',
              params: { allowedValues: schema66.properties.employment.properties.nature.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err60];
            } else {
              vErrors.push(err60);
            }
            errors++;
          }
        }
        if (data15.natureOther !== undefined) {
          let data19 = data15.natureOther;
          if (typeof data19 === 'string') {
            if (func2(data19) > 100) {
              const err61 = {
                instancePath: instancePath + '/employment/natureOther',
                schemaPath: '#/properties/employment/properties/natureOther/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err61];
              } else {
                vErrors.push(err61);
              }
              errors++;
            }
          } else {
            const err62 = {
              instancePath: instancePath + '/employment/natureOther',
              schemaPath: '#/properties/employment/properties/natureOther/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err62];
            } else {
              vErrors.push(err62);
            }
            errors++;
          }
        }
        if (data15.responsibleCommission !== undefined) {
          let data20 = data15.responsibleCommission;
          if (typeof data20 === 'string') {
            if (!pattern4.test(data20)) {
              const err63 = {
                instancePath: instancePath + '/employment/responsibleCommission',
                schemaPath: '#/properties/employment/properties/responsibleCommission/pattern',
                keyword: 'pattern',
                params: { pattern: '^[a-z][a-z0-9]{1,19}$' },
                message: 'must match pattern "' + '^[a-z][a-z0-9]{1,19}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err63];
              } else {
                vErrors.push(err63);
              }
              errors++;
            }
          } else {
            const err64 = {
              instancePath: instancePath + '/employment/responsibleCommission',
              schemaPath: '#/properties/employment/properties/responsibleCommission/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err64];
            } else {
              vErrors.push(err64);
            }
            errors++;
          }
        }
        if (data15.personnelFileNumber !== undefined) {
          let data21 = data15.personnelFileNumber;
          if (typeof data21 === 'string') {
            if (func2(data21) > 30) {
              const err65 = {
                instancePath: instancePath + '/employment/personnelFileNumber',
                schemaPath: '#/properties/employment/properties/personnelFileNumber/maxLength',
                keyword: 'maxLength',
                params: { limit: 30 },
                message: 'must NOT have more than 30 characters',
              };
              if (vErrors === null) {
                vErrors = [err65];
              } else {
                vErrors.push(err65);
              }
              errors++;
            }
          } else {
            const err66 = {
              instancePath: instancePath + '/employment/personnelFileNumber',
              schemaPath: '#/properties/employment/properties/personnelFileNumber/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err66];
            } else {
              vErrors.push(err66);
            }
            errors++;
          }
        }
        if (data15.jobGroup !== undefined) {
          let data22 = data15.jobGroup;
          if (typeof data22 === 'string') {
            if (func2(data22) > 40) {
              const err67 = {
                instancePath: instancePath + '/employment/jobGroup',
                schemaPath: '#/properties/employment/properties/jobGroup/maxLength',
                keyword: 'maxLength',
                params: { limit: 40 },
                message: 'must NOT have more than 40 characters',
              };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
          } else {
            const err68 = {
              instancePath: instancePath + '/employment/jobGroup',
              schemaPath: '#/properties/employment/properties/jobGroup/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err68];
            } else {
              vErrors.push(err68);
            }
            errors++;
          }
        }
        if (data15.appointmentDate !== undefined) {
          let data23 = data15.appointmentDate;
          if (typeof data23 === 'string') {
            if (!formats0.validate(data23)) {
              const err69 = {
                instancePath: instancePath + '/employment/appointmentDate',
                schemaPath: '#/properties/employment/properties/appointmentDate/format',
                keyword: 'format',
                params: { format: 'date' },
                message: 'must match format "' + 'date' + '"',
              };
              if (vErrors === null) {
                vErrors = [err69];
              } else {
                vErrors.push(err69);
              }
              errors++;
            }
          } else {
            const err70 = {
              instancePath: instancePath + '/employment/appointmentDate',
              schemaPath: '#/properties/employment/properties/appointmentDate/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err70];
            } else {
              vErrors.push(err70);
            }
            errors++;
          }
        }
        if (data15.workStation !== undefined) {
          let data24 = data15.workStation;
          if (typeof data24 === 'string') {
            if (func2(data24) > 100) {
              const err71 = {
                instancePath: instancePath + '/employment/workStation',
                schemaPath: '#/properties/employment/properties/workStation/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err71];
              } else {
                vErrors.push(err71);
              }
              errors++;
            }
          } else {
            const err72 = {
              instancePath: instancePath + '/employment/workStation',
              schemaPath: '#/properties/employment/properties/workStation/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err72];
            } else {
              vErrors.push(err72);
            }
            errors++;
          }
        }
      } else {
        const err73 = {
          instancePath: instancePath + '/employment',
          schemaPath: '#/properties/employment/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err73];
        } else {
          vErrors.push(err73);
        }
        errors++;
      }
    }
  } else {
    const err74 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err74];
    } else {
      vErrors.push(err74);
    }
    errors++;
  }
  validate38.errors = vErrors;
  return errors === 0;
}
validate38.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate37(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate37.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate38(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate38.errors : vErrors.concat(validate38.errors);
    errors = vErrors.length;
  }
  validate37.errors = vErrors;
  return errors === 0;
}
validate37.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export const householdSection = validate40;
const schema69 = {
  type: 'object',
  required: ['spouses', 'children'],
  additionalProperties: false,
  properties: {
    spouses: { $ref: 'https://adili.go.ke/schemas/declaration.v1.json#/properties/spouses' },
    children: { $ref: 'https://adili.go.ke/schemas/declaration.v1.json#/properties/children' },
  },
};
const schema70 = {
  type: 'object',
  description: 'Paragraph 6',
  required: ['none', 'items'],
  additionalProperties: false,
  properties: {
    none: { type: 'boolean', description: 'Explicit declaration that there is no spouse' },
    items: { type: 'array', items: { $ref: '#/$defs/Spouse' } },
  },
};
function validate41(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate41.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.none === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'none' },
        message: "must have required property '" + 'none' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.items === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'items' },
        message: "must have required property '" + 'items' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === 'none' || key0 === 'items')) {
        const err2 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.none !== undefined) {
      if (typeof data.none !== 'boolean') {
        const err3 = {
          instancePath: instancePath + '/none',
          schemaPath: '#/properties/none/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.items !== undefined) {
      let data1 = data.items;
      if (Array.isArray(data1)) {
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (
            !validate21(data1[i0], {
              instancePath: instancePath + '/items/' + i0,
              parentData: data1,
              parentDataProperty: i0,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err4 = {
          instancePath: instancePath + '/items',
          schemaPath: '#/properties/items/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
  } else {
    const err5 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err5];
    } else {
      vErrors.push(err5);
    }
    errors++;
  }
  validate41.errors = vErrors;
  return errors === 0;
}
validate41.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
const schema71 = {
  type: 'object',
  description: 'Paragraph 7',
  required: ['none', 'items'],
  additionalProperties: false,
  properties: {
    none: {
      type: 'boolean',
      description: 'Explicit declaration that there are no dependent children under 18',
    },
    items: { type: 'array', items: { $ref: '#/$defs/Child' } },
  },
};
function validate44(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate44.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.none === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'none' },
        message: "must have required property '" + 'none' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.items === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'items' },
        message: "must have required property '" + 'items' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === 'none' || key0 === 'items')) {
        const err2 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.none !== undefined) {
      if (typeof data.none !== 'boolean') {
        const err3 = {
          instancePath: instancePath + '/none',
          schemaPath: '#/properties/none/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.items !== undefined) {
      let data1 = data.items;
      if (Array.isArray(data1)) {
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (
            !validate23(data1[i0], {
              instancePath: instancePath + '/items/' + i0,
              parentData: data1,
              parentDataProperty: i0,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate23.errors : vErrors.concat(validate23.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err4 = {
          instancePath: instancePath + '/items',
          schemaPath: '#/properties/items/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
  } else {
    const err5 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err5];
    } else {
      vErrors.push(err5);
    }
    errors++;
  }
  validate44.errors = vErrors;
  return errors === 0;
}
validate44.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate40(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate40.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.spouses === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'spouses' },
        message: "must have required property '" + 'spouses' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.children === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'children' },
        message: "must have required property '" + 'children' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === 'spouses' || key0 === 'children')) {
        const err2 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.spouses !== undefined) {
      if (
        !validate41(data.spouses, {
          instancePath: instancePath + '/spouses',
          parentData: data,
          parentDataProperty: 'spouses',
          rootData,
          dynamicAnchors,
        })
      ) {
        vErrors = vErrors === null ? validate41.errors : vErrors.concat(validate41.errors);
        errors = vErrors.length;
      }
    }
    if (data.children !== undefined) {
      if (
        !validate44(data.children, {
          instancePath: instancePath + '/children',
          parentData: data,
          parentDataProperty: 'children',
          rootData,
          dynamicAnchors,
        })
      ) {
        vErrors = vErrors === null ? validate44.errors : vErrors.concat(validate44.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err3 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err3];
    } else {
      vErrors.push(err3);
    }
    errors++;
  }
  validate40.errors = vErrors;
  return errors === 0;
}
validate40.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export const otherSection = validate47;
const schema72 = {
  $ref: 'https://adili.go.ke/schemas/declaration.v1.json#/properties/otherInformation',
};
const schema73 = {
  type: 'object',
  description: 'Paragraph 9; material changes per Regs r.21',
  required: ['materialChanges', 'registrableInterests', 'freeText'],
  additionalProperties: false,
  properties: {
    materialChanges: {
      type: 'array',
      description: 'Composed from flagged items and the marital status change',
      items: { $ref: '#/$defs/MaterialChangeEntry' },
    },
    registrableInterests: { $ref: '#/$defs/RegistrableInterests' },
    freeText: { type: 'string', maxLength: 4000 },
  },
};
function validate48(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate48.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.materialChanges === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'materialChanges' },
        message: "must have required property '" + 'materialChanges' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.registrableInterests === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'registrableInterests' },
        message: "must have required property '" + 'registrableInterests' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.freeText === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'freeText' },
        message: "must have required property '" + 'freeText' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === 'materialChanges' || key0 === 'registrableInterests' || key0 === 'freeText')) {
        const err3 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.materialChanges !== undefined) {
      let data0 = data.materialChanges;
      if (Array.isArray(data0)) {
        const len0 = data0.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (
            !validate33(data0[i0], {
              instancePath: instancePath + '/materialChanges/' + i0,
              parentData: data0,
              parentDataProperty: i0,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate33.errors : vErrors.concat(validate33.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err4 = {
          instancePath: instancePath + '/materialChanges',
          schemaPath: '#/properties/materialChanges/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.registrableInterests !== undefined) {
      if (
        !validate35(data.registrableInterests, {
          instancePath: instancePath + '/registrableInterests',
          parentData: data,
          parentDataProperty: 'registrableInterests',
          rootData,
          dynamicAnchors,
        })
      ) {
        vErrors = vErrors === null ? validate35.errors : vErrors.concat(validate35.errors);
        errors = vErrors.length;
      }
    }
    if (data.freeText !== undefined) {
      let data3 = data.freeText;
      if (typeof data3 === 'string') {
        if (func2(data3) > 4000) {
          const err5 = {
            instancePath: instancePath + '/freeText',
            schemaPath: '#/properties/freeText/maxLength',
            keyword: 'maxLength',
            params: { limit: 4000 },
            message: 'must NOT have more than 4000 characters',
          };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = {
          instancePath: instancePath + '/freeText',
          schemaPath: '#/properties/freeText/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate48.errors = vErrors;
  return errors === 0;
}
validate48.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate47(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate47.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate48(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate48.errors : vErrors.concat(validate48.errors);
    errors = vErrors.length;
  }
  validate47.errors = vErrors;
  return errors === 0;
}
validate47.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export const statementSection = validate52;
const schema74 = { $ref: 'https://adili.go.ke/schemas/declaration.v1.json#/$defs/Statement' };
function validate53(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate53.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.incomeNil !== undefined) {
      if (true !== data.incomeNil) {
        const err0 = {};
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  let ifClause0;
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.income !== undefined) {
        let data1 = data.income;
        if (Array.isArray(data1)) {
          if (data1.length > 0) {
            const err1 = {
              instancePath: instancePath + '/income',
              schemaPath: '#/allOf/0/then/properties/income/maxItems',
              keyword: 'maxItems',
              params: { limit: 0 },
              message: 'must NOT have more than 0 items',
            };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
    if (valid1) {
      var props0 = {};
      props0.income = true;
      props0.incomeNil = true;
    }
    ifClause0 = 'then';
  } else {
    const _errs7 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.income !== undefined) {
        let data2 = data.income;
        if (Array.isArray(data2)) {
          if (data2.length < 1) {
            const err2 = {
              instancePath: instancePath + '/income',
              schemaPath: '#/allOf/0/else/properties/income/minItems',
              keyword: 'minItems',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 items',
            };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs7 === errors;
    valid1 = _valid0;
    if (valid1) {
      if (props0 !== true) {
        props0 = props0 || {};
        props0.income = true;
      }
    }
    ifClause0 = 'else';
  }
  if (!valid1) {
    const err3 = {
      instancePath,
      schemaPath: '#/allOf/0/if',
      keyword: 'if',
      params: { failingKeyword: ifClause0 },
      message: 'must match "' + ifClause0 + '" schema',
    };
    if (vErrors === null) {
      vErrors = [err3];
    } else {
      vErrors.push(err3);
    }
    errors++;
  }
  const _errs10 = errors;
  let valid5 = true;
  const _errs11 = errors;
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.assetsNil !== undefined) {
      if (true !== data.assetsNil) {
        const err4 = {};
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
  }
  var _valid1 = _errs11 === errors;
  errors = _errs10;
  if (vErrors !== null) {
    if (_errs10) {
      vErrors.length = _errs10;
    } else {
      vErrors = null;
    }
  }
  let ifClause1;
  if (_valid1) {
    const _errs13 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.assets !== undefined) {
        let data4 = data.assets;
        if (Array.isArray(data4)) {
          if (data4.length > 0) {
            const err5 = {
              instancePath: instancePath + '/assets',
              schemaPath: '#/allOf/1/then/properties/assets/maxItems',
              keyword: 'maxItems',
              params: { limit: 0 },
              message: 'must NOT have more than 0 items',
            };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        }
      }
    }
    var _valid1 = _errs13 === errors;
    valid5 = _valid1;
    if (valid5) {
      var props1 = {};
      props1.assets = true;
      props1.assetsNil = true;
    }
    ifClause1 = 'then';
  } else {
    const _errs15 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.assets !== undefined) {
        let data5 = data.assets;
        if (Array.isArray(data5)) {
          if (data5.length < 1) {
            const err6 = {
              instancePath: instancePath + '/assets',
              schemaPath: '#/allOf/1/else/properties/assets/minItems',
              keyword: 'minItems',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 items',
            };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
      }
    }
    var _valid1 = _errs15 === errors;
    valid5 = _valid1;
    if (valid5) {
      if (props1 !== true) {
        props1 = props1 || {};
        props1.assets = true;
      }
    }
    ifClause1 = 'else';
  }
  if (!valid5) {
    const err7 = {
      instancePath,
      schemaPath: '#/allOf/1/if',
      keyword: 'if',
      params: { failingKeyword: ifClause1 },
      message: 'must match "' + ifClause1 + '" schema',
    };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  if (props0 !== true && props1 !== undefined) {
    if (props1 === true) {
      props0 = true;
    } else {
      props0 = props0 || {};
      Object.assign(props0, props1);
    }
  }
  const _errs18 = errors;
  let valid9 = true;
  const _errs19 = errors;
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.liabilitiesNil !== undefined) {
      if (true !== data.liabilitiesNil) {
        const err8 = {};
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
  }
  var _valid2 = _errs19 === errors;
  errors = _errs18;
  if (vErrors !== null) {
    if (_errs18) {
      vErrors.length = _errs18;
    } else {
      vErrors = null;
    }
  }
  let ifClause2;
  if (_valid2) {
    const _errs21 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.liabilities !== undefined) {
        let data7 = data.liabilities;
        if (Array.isArray(data7)) {
          if (data7.length > 0) {
            const err9 = {
              instancePath: instancePath + '/liabilities',
              schemaPath: '#/allOf/2/then/properties/liabilities/maxItems',
              keyword: 'maxItems',
              params: { limit: 0 },
              message: 'must NOT have more than 0 items',
            };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
      }
    }
    var _valid2 = _errs21 === errors;
    valid9 = _valid2;
    if (valid9) {
      var props2 = {};
      props2.liabilities = true;
      props2.liabilitiesNil = true;
    }
    ifClause2 = 'then';
  } else {
    const _errs23 = errors;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.liabilities !== undefined) {
        let data8 = data.liabilities;
        if (Array.isArray(data8)) {
          if (data8.length < 1) {
            const err10 = {
              instancePath: instancePath + '/liabilities',
              schemaPath: '#/allOf/2/else/properties/liabilities/minItems',
              keyword: 'minItems',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 items',
            };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
        }
      }
    }
    var _valid2 = _errs23 === errors;
    valid9 = _valid2;
    if (valid9) {
      if (props2 !== true) {
        props2 = props2 || {};
        props2.liabilities = true;
      }
    }
    ifClause2 = 'else';
  }
  if (!valid9) {
    const err11 = {
      instancePath,
      schemaPath: '#/allOf/2/if',
      keyword: 'if',
      params: { failingKeyword: ifClause2 },
      message: 'must match "' + ifClause2 + '" schema',
    };
    if (vErrors === null) {
      vErrors = [err11];
    } else {
      vErrors.push(err11);
    }
    errors++;
  }
  if (props0 !== true && props2 !== undefined) {
    if (props2 === true) {
      props0 = true;
    } else {
      props0 = props0 || {};
      Object.assign(props0, props2);
    }
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.personKey === undefined) {
      const err12 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'personKey' },
        message: "must have required property '" + 'personKey' + "'",
      };
      if (vErrors === null) {
        vErrors = [err12];
      } else {
        vErrors.push(err12);
      }
      errors++;
    }
    if (data.personName === undefined) {
      const err13 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'personName' },
        message: "must have required property '" + 'personName' + "'",
      };
      if (vErrors === null) {
        vErrors = [err13];
      } else {
        vErrors.push(err13);
      }
      errors++;
    }
    if (data.statementDate === undefined) {
      const err14 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'statementDate' },
        message: "must have required property '" + 'statementDate' + "'",
      };
      if (vErrors === null) {
        vErrors = [err14];
      } else {
        vErrors.push(err14);
      }
      errors++;
    }
    if (data.incomePeriod === undefined) {
      const err15 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'incomePeriod' },
        message: "must have required property '" + 'incomePeriod' + "'",
      };
      if (vErrors === null) {
        vErrors = [err15];
      } else {
        vErrors.push(err15);
      }
      errors++;
    }
    if (data.incomeNil === undefined) {
      const err16 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'incomeNil' },
        message: "must have required property '" + 'incomeNil' + "'",
      };
      if (vErrors === null) {
        vErrors = [err16];
      } else {
        vErrors.push(err16);
      }
      errors++;
    }
    if (data.income === undefined) {
      const err17 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'income' },
        message: "must have required property '" + 'income' + "'",
      };
      if (vErrors === null) {
        vErrors = [err17];
      } else {
        vErrors.push(err17);
      }
      errors++;
    }
    if (data.assetsNil === undefined) {
      const err18 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'assetsNil' },
        message: "must have required property '" + 'assetsNil' + "'",
      };
      if (vErrors === null) {
        vErrors = [err18];
      } else {
        vErrors.push(err18);
      }
      errors++;
    }
    if (data.assets === undefined) {
      const err19 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'assets' },
        message: "must have required property '" + 'assets' + "'",
      };
      if (vErrors === null) {
        vErrors = [err19];
      } else {
        vErrors.push(err19);
      }
      errors++;
    }
    if (data.liabilitiesNil === undefined) {
      const err20 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'liabilitiesNil' },
        message: "must have required property '" + 'liabilitiesNil' + "'",
      };
      if (vErrors === null) {
        vErrors = [err20];
      } else {
        vErrors.push(err20);
      }
      errors++;
    }
    if (data.liabilities === undefined) {
      const err21 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'liabilities' },
        message: "must have required property '" + 'liabilities' + "'",
      };
      if (vErrors === null) {
        vErrors = [err21];
      } else {
        vErrors.push(err21);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema38.properties, key0)) {
        const err22 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.personKey !== undefined) {
      let data9 = data.personKey;
      if (typeof data9 === 'string') {
        if (!pattern8.test(data9)) {
          const err23 = {
            instancePath: instancePath + '/personKey',
            schemaPath: '#/$defs/PersonKey/pattern',
            keyword: 'pattern',
            params: { pattern: '^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$' },
            message:
              'must match pattern "' + '^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$' + '"',
          };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        }
      } else {
        const err24 = {
          instancePath: instancePath + '/personKey',
          schemaPath: '#/$defs/PersonKey/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.personName !== undefined) {
      let data10 = data.personName;
      if (data10 && typeof data10 == 'object' && !Array.isArray(data10)) {
        if (data10.surname === undefined) {
          const err25 = {
            instancePath: instancePath + '/personName',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'surname' },
            message: "must have required property '" + 'surname' + "'",
          };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
        if (data10.firstName === undefined) {
          const err26 = {
            instancePath: instancePath + '/personName',
            schemaPath: '#/$defs/PersonName/required',
            keyword: 'required',
            params: { missingProperty: 'firstName' },
            message: "must have required property '" + 'firstName' + "'",
          };
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
        for (const key1 in data10) {
          if (!(key1 === 'surname' || key1 === 'firstName' || key1 === 'otherNames')) {
            const err27 = {
              instancePath: instancePath + '/personName',
              schemaPath: '#/$defs/PersonName/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err27];
            } else {
              vErrors.push(err27);
            }
            errors++;
          }
        }
        if (data10.surname !== undefined) {
          let data11 = data10.surname;
          if (typeof data11 === 'string') {
            if (func2(data11) > 100) {
              const err28 = {
                instancePath: instancePath + '/personName/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err28];
              } else {
                vErrors.push(err28);
              }
              errors++;
            }
            if (func2(data11) < 1) {
              const err29 = {
                instancePath: instancePath + '/personName/surname',
                schemaPath: '#/$defs/PersonName/properties/surname/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err29];
              } else {
                vErrors.push(err29);
              }
              errors++;
            }
          } else {
            const err30 = {
              instancePath: instancePath + '/personName/surname',
              schemaPath: '#/$defs/PersonName/properties/surname/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err30];
            } else {
              vErrors.push(err30);
            }
            errors++;
          }
        }
        if (data10.firstName !== undefined) {
          let data12 = data10.firstName;
          if (typeof data12 === 'string') {
            if (func2(data12) > 100) {
              const err31 = {
                instancePath: instancePath + '/personName/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
            if (func2(data12) < 1) {
              const err32 = {
                instancePath: instancePath + '/personName/firstName',
                schemaPath: '#/$defs/PersonName/properties/firstName/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err32];
              } else {
                vErrors.push(err32);
              }
              errors++;
            }
          } else {
            const err33 = {
              instancePath: instancePath + '/personName/firstName',
              schemaPath: '#/$defs/PersonName/properties/firstName/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err33];
            } else {
              vErrors.push(err33);
            }
            errors++;
          }
        }
        if (data10.otherNames !== undefined) {
          let data13 = data10.otherNames;
          if (typeof data13 === 'string') {
            if (func2(data13) > 200) {
              const err34 = {
                instancePath: instancePath + '/personName/otherNames',
                schemaPath: '#/$defs/PersonName/properties/otherNames/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err34];
              } else {
                vErrors.push(err34);
              }
              errors++;
            }
          } else {
            const err35 = {
              instancePath: instancePath + '/personName/otherNames',
              schemaPath: '#/$defs/PersonName/properties/otherNames/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
      } else {
        const err36 = {
          instancePath: instancePath + '/personName',
          schemaPath: '#/$defs/PersonName/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
    }
    if (data.statementDate !== undefined) {
      let data14 = data.statementDate;
      if (typeof data14 === 'string') {
        if (!formats0.validate(data14)) {
          const err37 = {
            instancePath: instancePath + '/statementDate',
            schemaPath: '#/properties/statementDate/format',
            keyword: 'format',
            params: { format: 'date' },
            message: 'must match format "' + 'date' + '"',
          };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
      } else {
        const err38 = {
          instancePath: instancePath + '/statementDate',
          schemaPath: '#/properties/statementDate/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err38];
        } else {
          vErrors.push(err38);
        }
        errors++;
      }
    }
    if (data.incomePeriod !== undefined) {
      let data15 = data.incomePeriod;
      if (data15 && typeof data15 == 'object' && !Array.isArray(data15)) {
        if (data15.from === undefined) {
          const err39 = {
            instancePath: instancePath + '/incomePeriod',
            schemaPath: '#/properties/incomePeriod/required',
            keyword: 'required',
            params: { missingProperty: 'from' },
            message: "must have required property '" + 'from' + "'",
          };
          if (vErrors === null) {
            vErrors = [err39];
          } else {
            vErrors.push(err39);
          }
          errors++;
        }
        if (data15.to === undefined) {
          const err40 = {
            instancePath: instancePath + '/incomePeriod',
            schemaPath: '#/properties/incomePeriod/required',
            keyword: 'required',
            params: { missingProperty: 'to' },
            message: "must have required property '" + 'to' + "'",
          };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        for (const key2 in data15) {
          if (!(key2 === 'from' || key2 === 'to')) {
            const err41 = {
              instancePath: instancePath + '/incomePeriod',
              schemaPath: '#/properties/incomePeriod/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key2 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err41];
            } else {
              vErrors.push(err41);
            }
            errors++;
          }
        }
        if (data15.from !== undefined) {
          let data16 = data15.from;
          if (typeof data16 === 'string') {
            if (!formats0.validate(data16)) {
              const err42 = {
                instancePath: instancePath + '/incomePeriod/from',
                schemaPath: '#/properties/incomePeriod/properties/from/format',
                keyword: 'format',
                params: { format: 'date' },
                message: 'must match format "' + 'date' + '"',
              };
              if (vErrors === null) {
                vErrors = [err42];
              } else {
                vErrors.push(err42);
              }
              errors++;
            }
          } else {
            const err43 = {
              instancePath: instancePath + '/incomePeriod/from',
              schemaPath: '#/properties/incomePeriod/properties/from/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err43];
            } else {
              vErrors.push(err43);
            }
            errors++;
          }
        }
        if (data15.to !== undefined) {
          let data17 = data15.to;
          if (typeof data17 === 'string') {
            if (!formats0.validate(data17)) {
              const err44 = {
                instancePath: instancePath + '/incomePeriod/to',
                schemaPath: '#/properties/incomePeriod/properties/to/format',
                keyword: 'format',
                params: { format: 'date' },
                message: 'must match format "' + 'date' + '"',
              };
              if (vErrors === null) {
                vErrors = [err44];
              } else {
                vErrors.push(err44);
              }
              errors++;
            }
          } else {
            const err45 = {
              instancePath: instancePath + '/incomePeriod/to',
              schemaPath: '#/properties/incomePeriod/properties/to/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
        }
      } else {
        const err46 = {
          instancePath: instancePath + '/incomePeriod',
          schemaPath: '#/properties/incomePeriod/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err46];
        } else {
          vErrors.push(err46);
        }
        errors++;
      }
    }
    if (data.incomeNil !== undefined) {
      if (typeof data.incomeNil !== 'boolean') {
        const err47 = {
          instancePath: instancePath + '/incomeNil',
          schemaPath: '#/properties/incomeNil/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err47];
        } else {
          vErrors.push(err47);
        }
        errors++;
      }
    }
    if (data.income !== undefined) {
      let data19 = data.income;
      if (Array.isArray(data19)) {
        const len0 = data19.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (
            !validate26(data19[i0], {
              instancePath: instancePath + '/income/' + i0,
              parentData: data19,
              parentDataProperty: i0,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate26.errors : vErrors.concat(validate26.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err48 = {
          instancePath: instancePath + '/income',
          schemaPath: '#/properties/income/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err48];
        } else {
          vErrors.push(err48);
        }
        errors++;
      }
    }
    if (data.assetsNil !== undefined) {
      if (typeof data.assetsNil !== 'boolean') {
        const err49 = {
          instancePath: instancePath + '/assetsNil',
          schemaPath: '#/properties/assetsNil/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err49];
        } else {
          vErrors.push(err49);
        }
        errors++;
      }
    }
    if (data.assets !== undefined) {
      let data22 = data.assets;
      if (Array.isArray(data22)) {
        const len1 = data22.length;
        for (let i1 = 0; i1 < len1; i1++) {
          if (
            !validate28(data22[i1], {
              instancePath: instancePath + '/assets/' + i1,
              parentData: data22,
              parentDataProperty: i1,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate28.errors : vErrors.concat(validate28.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err50 = {
          instancePath: instancePath + '/assets',
          schemaPath: '#/properties/assets/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err50];
        } else {
          vErrors.push(err50);
        }
        errors++;
      }
    }
    if (data.liabilitiesNil !== undefined) {
      if (typeof data.liabilitiesNil !== 'boolean') {
        const err51 = {
          instancePath: instancePath + '/liabilitiesNil',
          schemaPath: '#/properties/liabilitiesNil/type',
          keyword: 'type',
          params: { type: 'boolean' },
          message: 'must be boolean',
        };
        if (vErrors === null) {
          vErrors = [err51];
        } else {
          vErrors.push(err51);
        }
        errors++;
      }
    }
    if (data.liabilities !== undefined) {
      let data25 = data.liabilities;
      if (Array.isArray(data25)) {
        const len2 = data25.length;
        for (let i2 = 0; i2 < len2; i2++) {
          if (
            !validate30(data25[i2], {
              instancePath: instancePath + '/liabilities/' + i2,
              parentData: data25,
              parentDataProperty: i2,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err52 = {
          instancePath: instancePath + '/liabilities',
          schemaPath: '#/properties/liabilities/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err52];
        } else {
          vErrors.push(err52);
        }
        errors++;
      }
    }
    if (data.knowledgeLimitation !== undefined) {
      let data27 = data.knowledgeLimitation;
      if (typeof data27 === 'string') {
        if (func2(data27) > 1000) {
          const err53 = {
            instancePath: instancePath + '/knowledgeLimitation',
            schemaPath: '#/properties/knowledgeLimitation/maxLength',
            keyword: 'maxLength',
            params: { limit: 1000 },
            message: 'must NOT have more than 1000 characters',
          };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
      } else {
        const err54 = {
          instancePath: instancePath + '/knowledgeLimitation',
          schemaPath: '#/properties/knowledgeLimitation/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err54];
        } else {
          vErrors.push(err54);
        }
        errors++;
      }
    }
  } else {
    const err55 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err55];
    } else {
      vErrors.push(err55);
    }
    errors++;
  }
  validate53.errors = vErrors;
  return errors === 0;
}
validate53.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate52(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate52.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (
    !validate53(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
    errors = vErrors.length;
  }
  validate52.errors = vErrors;
  return errors === 0;
}
validate52.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
