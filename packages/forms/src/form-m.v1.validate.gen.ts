/* Generated from @adili/schemas/forms/form-m.v1.json by scripts/generate-validators.ts. Do not edit. */
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
export const formM = validate20;
const schema31 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://adili.go.ke/schemas/form-m.v1.json',
  title: 'Form M: Compliance report by a Responsible Commission (Regs r.25(2)(a))',
  description:
    'One compliance report per Responsible Commission per financial year (1 July to 30 June), mirroring the prescribed Form M: Part I description, Part II declarations (sections 1-5) and complaints (sections 6-7), Part III authentication. Draft: spec 09.',
  type: 'object',
  required: ['schemaVersion', 'partI', 'partII', 'partIII'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 'form-m.v1' },
    partI: {
      type: 'object',
      description: 'Description of the Responsible Commission',
      required: [
        'commissionName',
        'issuerCode',
        'contactDetails',
        'physicalAddress',
        'emailAddress',
        'period',
      ],
      additionalProperties: false,
      properties: {
        commissionName: { type: 'string', minLength: 1, maxLength: 200 },
        issuerCode: { type: 'string', pattern: '^[A-Z0-9]{2,20}$' },
        contactDetails: { type: 'string', maxLength: 200 },
        physicalAddress: { type: 'string', maxLength: 200 },
        emailAddress: { type: 'string', format: 'email' },
        period: {
          type: 'object',
          required: ['from', 'to', 'financialYearStart'],
          additionalProperties: false,
          properties: {
            from: { type: 'string', format: 'date', description: '1 July of the FY start year' },
            to: { type: 'string', format: 'date', description: '30 June of the following year' },
            financialYearStart: { type: 'integer', minimum: 2025 },
          },
        },
      },
    },
    partII: {
      type: 'object',
      required: ['initial', 'biennial', 'final', 'clarifications', 'accessRequests', 'complaints'],
      additionalProperties: false,
      properties: {
        initial: { $ref: '#/$defs/DeclarationSection' },
        biennial: {
          allOf: [
            { $ref: '#/$defs/DeclarationSection' },
            {
              type: 'object',
              properties: {
                noCycleInPeriod: {
                  type: 'boolean',
                  description: 'True in a financial year with no biennial statement date',
                },
              },
            },
          ],
        },
        final: { $ref: '#/$defs/DeclarationSection' },
        clarifications: {
          type: 'object',
          description:
            'Section 4: public officers from whom clarification was sought and status of compliance',
          required: ['items'],
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: [
                  'name',
                  'designation',
                  'identifier',
                  'natureInGeneralTerms',
                  'statusOfCompliance',
                ],
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  designation: { type: 'string' },
                  identifier: { type: 'string', description: 'Staff, file, ID or passport number' },
                  natureInGeneralTerms: { type: 'string', maxLength: 300 },
                  statusOfCompliance: {
                    type: 'string',
                    enum: ['responded', 'resolved', 'pending', 'overdue', 'withdrawn'],
                  },
                  clarificationReference: { type: 'string' },
                },
              },
            },
          },
        },
        accessRequests: {
          type: 'object',
          description:
            'Section 5: access to information in declarations or clarifications (Act s.36)',
          required: ['received', 'granted', 'declined', 'declineReasons', 'dataUnavailable'],
          additionalProperties: false,
          properties: {
            received: { type: 'integer', minimum: 0 },
            granted: { type: 'integer', minimum: 0 },
            declined: { type: 'integer', minimum: 0 },
            declineReasons: {
              type: 'array',
              items: {
                type: 'object',
                required: ['reason', 'count'],
                additionalProperties: false,
                properties: {
                  reason: {
                    type: 'string',
                    description: 'Regs r.24 grounds',
                    enum: [
                      'public-interest',
                      'prejudice-proceeding',
                      'frivolous-vexatious',
                      'not-objectives',
                      'other',
                    ],
                  },
                  count: { type: 'integer', minimum: 0 },
                },
              },
            },
            dataUnavailable: {
              type: 'boolean',
              description: 'True when access-request data is not yet captured on the platform',
            },
          },
        },
        complaints: {
          type: 'object',
          description: 'Part B, sections 6-7: complaints and investigations (entered manually)',
          required: ['registerMaintained', 'items'],
          additionalProperties: false,
          properties: {
            registerMaintained: { type: ['boolean', 'null'] },
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'designation', 'identifier', 'nature', 'status'],
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  designation: { type: 'string' },
                  identifier: { type: 'string' },
                  nature: { type: 'string', maxLength: 300 },
                  status: { type: 'string', maxLength: 100 },
                },
              },
            },
          },
        },
      },
    },
    partIII: {
      type: 'object',
      description: 'Authentication of information',
      required: ['compiledBy', 'confirmedBy'],
      additionalProperties: false,
      properties: {
        compiledBy: { $ref: '#/$defs/Signatory' },
        confirmedBy: { $ref: '#/$defs/Signatory' },
      },
    },
    meta: {
      type: 'object',
      description: 'Platform metadata, not part of the prescribed form',
      additionalProperties: false,
      properties: {
        compiledAt: { type: 'string', format: 'date-time' },
        reference: { type: 'string' },
        source: { type: 'string', enum: ['hosted', 'federated'] },
      },
    },
  },
  $defs: {
    Signatory: {
      type: 'object',
      required: ['name', 'designation', 'date'],
      additionalProperties: false,
      properties: {
        name: { type: ['string', 'null'], maxLength: 200 },
        designation: { type: ['string', 'null'], maxLength: 100 },
        date: { type: ['string', 'null'], format: 'date' },
      },
    },
    NonFilerRow: {
      type: 'object',
      required: ['name', 'designation', 'identifier', 'date', 'actionTaken', 'complied'],
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        designation: { type: 'string' },
        identifier: { type: 'string', description: 'Staff, file, ID or passport number' },
        date: {
          type: 'string',
          format: 'date',
          description: 'Date of appointment (initial, biennial) or of exit (final)',
        },
        actionTaken: {
          type: 'string',
          description: 'Latest administrative action step or none',
          enum: [
            'none',
            'notice-to-comply',
            'warning',
            'salary-stoppage',
            'disciplinary-referral',
            'referred-to-eacc',
          ],
        },
        complied: { type: 'string', enum: ['yes', 'no', 'pending'] },
        remarks: { type: 'string', maxLength: 500 },
        obligationId: { type: 'string', format: 'uuid' },
      },
    },
    DeclarationSection: {
      type: 'object',
      description: 'Sections 1-3: counts and the list of officers who did not declare',
      required: ['expected', 'declared', 'notDeclared', 'nonFilers'],
      additionalProperties: false,
      properties: {
        expected: {
          type: 'integer',
          minimum: 0,
          description:
            'Appointed (initial), in service (biennial) or exited (final) within the period',
        },
        declared: { type: 'integer', minimum: 0 },
        notDeclared: { type: 'integer', minimum: 0 },
        nonFilers: { type: 'array', items: { $ref: '#/$defs/NonFilerRow' } },
        noCycleInPeriod: { type: 'boolean' },
      },
    },
  },
};
const schema34 = {
  type: 'object',
  required: ['name', 'designation', 'date'],
  additionalProperties: false,
  properties: {
    name: { type: ['string', 'null'], maxLength: 200 },
    designation: { type: ['string', 'null'], maxLength: 100 },
    date: { type: ['string', 'null'], format: 'date' },
  },
};
const func1 = ucs2length;
const pattern4 = new RegExp('^[A-Z0-9]{2,20}$', 'u');
const formats0 =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const formats2 = fullFormats.date;
const formats14 = fullFormats['date-time'];
const schema32 = {
  type: 'object',
  description: 'Sections 1-3: counts and the list of officers who did not declare',
  required: ['expected', 'declared', 'notDeclared', 'nonFilers'],
  additionalProperties: false,
  properties: {
    expected: {
      type: 'integer',
      minimum: 0,
      description: 'Appointed (initial), in service (biennial) or exited (final) within the period',
    },
    declared: { type: 'integer', minimum: 0 },
    notDeclared: { type: 'integer', minimum: 0 },
    nonFilers: { type: 'array', items: { $ref: '#/$defs/NonFilerRow' } },
    noCycleInPeriod: { type: 'boolean' },
  },
};
const schema33 = {
  type: 'object',
  required: ['name', 'designation', 'identifier', 'date', 'actionTaken', 'complied'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    designation: { type: 'string' },
    identifier: { type: 'string', description: 'Staff, file, ID or passport number' },
    date: {
      type: 'string',
      format: 'date',
      description: 'Date of appointment (initial, biennial) or of exit (final)',
    },
    actionTaken: {
      type: 'string',
      description: 'Latest administrative action step or none',
      enum: [
        'none',
        'notice-to-comply',
        'warning',
        'salary-stoppage',
        'disciplinary-referral',
        'referred-to-eacc',
      ],
    },
    complied: { type: 'string', enum: ['yes', 'no', 'pending'] },
    remarks: { type: 'string', maxLength: 500 },
    obligationId: { type: 'string', format: 'uuid' },
  },
};
const formats8 = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
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
    if (data.expected === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'expected' },
        message: "must have required property '" + 'expected' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.declared === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'declared' },
        message: "must have required property '" + 'declared' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.notDeclared === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'notDeclared' },
        message: "must have required property '" + 'notDeclared' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.nonFilers === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'nonFilers' },
        message: "must have required property '" + 'nonFilers' + "'",
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
        key0 === 'expected' ||
        key0 === 'declared' ||
        key0 === 'notDeclared' ||
        key0 === 'nonFilers' ||
        key0 === 'noCycleInPeriod'
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
    if (data.expected !== undefined) {
      let data0 = data.expected;
      if (!(typeof data0 == 'number' && !(data0 % 1) && !isNaN(data0) && isFinite(data0))) {
        const err5 = {
          instancePath: instancePath + '/expected',
          schemaPath: '#/properties/expected/type',
          keyword: 'type',
          params: { type: 'integer' },
          message: 'must be integer',
        };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
      if (typeof data0 == 'number' && isFinite(data0)) {
        if (data0 < 0 || isNaN(data0)) {
          const err6 = {
            instancePath: instancePath + '/expected',
            schemaPath: '#/properties/expected/minimum',
            keyword: 'minimum',
            params: { comparison: '>=', limit: 0 },
            message: 'must be >= 0',
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
    if (data.declared !== undefined) {
      let data1 = data.declared;
      if (!(typeof data1 == 'number' && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        const err7 = {
          instancePath: instancePath + '/declared',
          schemaPath: '#/properties/declared/type',
          keyword: 'type',
          params: { type: 'integer' },
          message: 'must be integer',
        };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
      if (typeof data1 == 'number' && isFinite(data1)) {
        if (data1 < 0 || isNaN(data1)) {
          const err8 = {
            instancePath: instancePath + '/declared',
            schemaPath: '#/properties/declared/minimum',
            keyword: 'minimum',
            params: { comparison: '>=', limit: 0 },
            message: 'must be >= 0',
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      }
    }
    if (data.notDeclared !== undefined) {
      let data2 = data.notDeclared;
      if (!(typeof data2 == 'number' && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        const err9 = {
          instancePath: instancePath + '/notDeclared',
          schemaPath: '#/properties/notDeclared/type',
          keyword: 'type',
          params: { type: 'integer' },
          message: 'must be integer',
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
      if (typeof data2 == 'number' && isFinite(data2)) {
        if (data2 < 0 || isNaN(data2)) {
          const err10 = {
            instancePath: instancePath + '/notDeclared',
            schemaPath: '#/properties/notDeclared/minimum',
            keyword: 'minimum',
            params: { comparison: '>=', limit: 0 },
            message: 'must be >= 0',
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
    if (data.nonFilers !== undefined) {
      let data3 = data.nonFilers;
      if (Array.isArray(data3)) {
        const len0 = data3.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data4 = data3[i0];
          if (data4 && typeof data4 == 'object' && !Array.isArray(data4)) {
            if (data4.name === undefined) {
              const err11 = {
                instancePath: instancePath + '/nonFilers/' + i0,
                schemaPath: '#/$defs/NonFilerRow/required',
                keyword: 'required',
                params: { missingProperty: 'name' },
                message: "must have required property '" + 'name' + "'",
              };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
            if (data4.designation === undefined) {
              const err12 = {
                instancePath: instancePath + '/nonFilers/' + i0,
                schemaPath: '#/$defs/NonFilerRow/required',
                keyword: 'required',
                params: { missingProperty: 'designation' },
                message: "must have required property '" + 'designation' + "'",
              };
              if (vErrors === null) {
                vErrors = [err12];
              } else {
                vErrors.push(err12);
              }
              errors++;
            }
            if (data4.identifier === undefined) {
              const err13 = {
                instancePath: instancePath + '/nonFilers/' + i0,
                schemaPath: '#/$defs/NonFilerRow/required',
                keyword: 'required',
                params: { missingProperty: 'identifier' },
                message: "must have required property '" + 'identifier' + "'",
              };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
            if (data4.date === undefined) {
              const err14 = {
                instancePath: instancePath + '/nonFilers/' + i0,
                schemaPath: '#/$defs/NonFilerRow/required',
                keyword: 'required',
                params: { missingProperty: 'date' },
                message: "must have required property '" + 'date' + "'",
              };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
            }
            if (data4.actionTaken === undefined) {
              const err15 = {
                instancePath: instancePath + '/nonFilers/' + i0,
                schemaPath: '#/$defs/NonFilerRow/required',
                keyword: 'required',
                params: { missingProperty: 'actionTaken' },
                message: "must have required property '" + 'actionTaken' + "'",
              };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
            if (data4.complied === undefined) {
              const err16 = {
                instancePath: instancePath + '/nonFilers/' + i0,
                schemaPath: '#/$defs/NonFilerRow/required',
                keyword: 'required',
                params: { missingProperty: 'complied' },
                message: "must have required property '" + 'complied' + "'",
              };
              if (vErrors === null) {
                vErrors = [err16];
              } else {
                vErrors.push(err16);
              }
              errors++;
            }
            for (const key1 in data4) {
              if (!(
                key1 === 'name' ||
                key1 === 'designation' ||
                key1 === 'identifier' ||
                key1 === 'date' ||
                key1 === 'actionTaken' ||
                key1 === 'complied' ||
                key1 === 'remarks' ||
                key1 === 'obligationId'
              )) {
                const err17 = {
                  instancePath: instancePath + '/nonFilers/' + i0,
                  schemaPath: '#/$defs/NonFilerRow/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key1 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
              }
            }
            if (data4.name !== undefined) {
              if (typeof data4.name !== 'string') {
                const err18 = {
                  instancePath: instancePath + '/nonFilers/' + i0 + '/name',
                  schemaPath: '#/$defs/NonFilerRow/properties/name/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err18];
                } else {
                  vErrors.push(err18);
                }
                errors++;
              }
            }
            if (data4.designation !== undefined) {
              if (typeof data4.designation !== 'string') {
                const err19 = {
                  instancePath: instancePath + '/nonFilers/' + i0 + '/designation',
                  schemaPath: '#/$defs/NonFilerRow/properties/designation/type',
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
            if (data4.identifier !== undefined) {
              if (typeof data4.identifier !== 'string') {
                const err20 = {
                  instancePath: instancePath + '/nonFilers/' + i0 + '/identifier',
                  schemaPath: '#/$defs/NonFilerRow/properties/identifier/type',
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
            if (data4.date !== undefined) {
              let data8 = data4.date;
              if (typeof data8 === 'string') {
                if (!formats2.validate(data8)) {
                  const err21 = {
                    instancePath: instancePath + '/nonFilers/' + i0 + '/date',
                    schemaPath: '#/$defs/NonFilerRow/properties/date/format',
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
                  instancePath: instancePath + '/nonFilers/' + i0 + '/date',
                  schemaPath: '#/$defs/NonFilerRow/properties/date/type',
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
            if (data4.actionTaken !== undefined) {
              let data9 = data4.actionTaken;
              if (typeof data9 !== 'string') {
                const err23 = {
                  instancePath: instancePath + '/nonFilers/' + i0 + '/actionTaken',
                  schemaPath: '#/$defs/NonFilerRow/properties/actionTaken/type',
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
              if (!(
                data9 === 'none' ||
                data9 === 'notice-to-comply' ||
                data9 === 'warning' ||
                data9 === 'salary-stoppage' ||
                data9 === 'disciplinary-referral' ||
                data9 === 'referred-to-eacc'
              )) {
                const err24 = {
                  instancePath: instancePath + '/nonFilers/' + i0 + '/actionTaken',
                  schemaPath: '#/$defs/NonFilerRow/properties/actionTaken/enum',
                  keyword: 'enum',
                  params: { allowedValues: schema33.properties.actionTaken.enum },
                  message: 'must be equal to one of the allowed values',
                };
                if (vErrors === null) {
                  vErrors = [err24];
                } else {
                  vErrors.push(err24);
                }
                errors++;
              }
            }
            if (data4.complied !== undefined) {
              let data10 = data4.complied;
              if (typeof data10 !== 'string') {
                const err25 = {
                  instancePath: instancePath + '/nonFilers/' + i0 + '/complied',
                  schemaPath: '#/$defs/NonFilerRow/properties/complied/type',
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
              if (!(data10 === 'yes' || data10 === 'no' || data10 === 'pending')) {
                const err26 = {
                  instancePath: instancePath + '/nonFilers/' + i0 + '/complied',
                  schemaPath: '#/$defs/NonFilerRow/properties/complied/enum',
                  keyword: 'enum',
                  params: { allowedValues: schema33.properties.complied.enum },
                  message: 'must be equal to one of the allowed values',
                };
                if (vErrors === null) {
                  vErrors = [err26];
                } else {
                  vErrors.push(err26);
                }
                errors++;
              }
            }
            if (data4.remarks !== undefined) {
              let data11 = data4.remarks;
              if (typeof data11 === 'string') {
                if (func1(data11) > 500) {
                  const err27 = {
                    instancePath: instancePath + '/nonFilers/' + i0 + '/remarks',
                    schemaPath: '#/$defs/NonFilerRow/properties/remarks/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 500 },
                    message: 'must NOT have more than 500 characters',
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
                  instancePath: instancePath + '/nonFilers/' + i0 + '/remarks',
                  schemaPath: '#/$defs/NonFilerRow/properties/remarks/type',
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
            if (data4.obligationId !== undefined) {
              let data12 = data4.obligationId;
              if (typeof data12 === 'string') {
                if (!formats8.test(data12)) {
                  const err29 = {
                    instancePath: instancePath + '/nonFilers/' + i0 + '/obligationId',
                    schemaPath: '#/$defs/NonFilerRow/properties/obligationId/format',
                    keyword: 'format',
                    params: { format: 'uuid' },
                    message: 'must match format "' + 'uuid' + '"',
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
                  instancePath: instancePath + '/nonFilers/' + i0 + '/obligationId',
                  schemaPath: '#/$defs/NonFilerRow/properties/obligationId/type',
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
          } else {
            const err31 = {
              instancePath: instancePath + '/nonFilers/' + i0,
              schemaPath: '#/$defs/NonFilerRow/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err31];
            } else {
              vErrors.push(err31);
            }
            errors++;
          }
        }
      } else {
        const err32 = {
          instancePath: instancePath + '/nonFilers',
          schemaPath: '#/properties/nonFilers/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err32];
        } else {
          vErrors.push(err32);
        }
        errors++;
      }
    }
    if (data.noCycleInPeriod !== undefined) {
      if (typeof data.noCycleInPeriod !== 'boolean') {
        const err33 = {
          instancePath: instancePath + '/noCycleInPeriod',
          schemaPath: '#/properties/noCycleInPeriod/type',
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
  } else {
    const err34 = {
      instancePath,
      schemaPath: '#/type',
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
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate20(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  /*# sourceURL="https://adili.go.ke/schemas/form-m.v1.json" */ let vErrors = null;
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
    if (data.partI === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'partI' },
        message: "must have required property '" + 'partI' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.partII === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'partII' },
        message: "must have required property '" + 'partII' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.partIII === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'partIII' },
        message: "must have required property '" + 'partIII' + "'",
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
        key0 === 'schemaVersion' ||
        key0 === 'partI' ||
        key0 === 'partII' ||
        key0 === 'partIII' ||
        key0 === 'meta'
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
    if (data.schemaVersion !== undefined) {
      if ('form-m.v1' !== data.schemaVersion) {
        const err5 = {
          instancePath: instancePath + '/schemaVersion',
          schemaPath: '#/properties/schemaVersion/const',
          keyword: 'const',
          params: { allowedValue: 'form-m.v1' },
          message: 'must be equal to constant',
        };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.partI !== undefined) {
      let data1 = data.partI;
      if (data1 && typeof data1 == 'object' && !Array.isArray(data1)) {
        if (data1.commissionName === undefined) {
          const err6 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'commissionName' },
            message: "must have required property '" + 'commissionName' + "'",
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data1.issuerCode === undefined) {
          const err7 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'issuerCode' },
            message: "must have required property '" + 'issuerCode' + "'",
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        if (data1.contactDetails === undefined) {
          const err8 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'contactDetails' },
            message: "must have required property '" + 'contactDetails' + "'",
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
        if (data1.physicalAddress === undefined) {
          const err9 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'physicalAddress' },
            message: "must have required property '" + 'physicalAddress' + "'",
          };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (data1.emailAddress === undefined) {
          const err10 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'emailAddress' },
            message: "must have required property '" + 'emailAddress' + "'",
          };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
        if (data1.period === undefined) {
          const err11 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'period' },
            message: "must have required property '" + 'period' + "'",
          };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
        for (const key1 in data1) {
          if (!(
            key1 === 'commissionName' ||
            key1 === 'issuerCode' ||
            key1 === 'contactDetails' ||
            key1 === 'physicalAddress' ||
            key1 === 'emailAddress' ||
            key1 === 'period'
          )) {
            const err12 = {
              instancePath: instancePath + '/partI',
              schemaPath: '#/properties/partI/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
        if (data1.commissionName !== undefined) {
          let data2 = data1.commissionName;
          if (typeof data2 === 'string') {
            if (func1(data2) > 200) {
              const err13 = {
                instancePath: instancePath + '/partI/commissionName',
                schemaPath: '#/properties/partI/properties/commissionName/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
            if (func1(data2) < 1) {
              const err14 = {
                instancePath: instancePath + '/partI/commissionName',
                schemaPath: '#/properties/partI/properties/commissionName/minLength',
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
              instancePath: instancePath + '/partI/commissionName',
              schemaPath: '#/properties/partI/properties/commissionName/type',
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
        if (data1.issuerCode !== undefined) {
          let data3 = data1.issuerCode;
          if (typeof data3 === 'string') {
            if (!pattern4.test(data3)) {
              const err16 = {
                instancePath: instancePath + '/partI/issuerCode',
                schemaPath: '#/properties/partI/properties/issuerCode/pattern',
                keyword: 'pattern',
                params: { pattern: '^[A-Z0-9]{2,20}$' },
                message: 'must match pattern "' + '^[A-Z0-9]{2,20}$' + '"',
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
              instancePath: instancePath + '/partI/issuerCode',
              schemaPath: '#/properties/partI/properties/issuerCode/type',
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
        if (data1.contactDetails !== undefined) {
          let data4 = data1.contactDetails;
          if (typeof data4 === 'string') {
            if (func1(data4) > 200) {
              const err18 = {
                instancePath: instancePath + '/partI/contactDetails',
                schemaPath: '#/properties/partI/properties/contactDetails/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
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
              instancePath: instancePath + '/partI/contactDetails',
              schemaPath: '#/properties/partI/properties/contactDetails/type',
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
        if (data1.physicalAddress !== undefined) {
          let data5 = data1.physicalAddress;
          if (typeof data5 === 'string') {
            if (func1(data5) > 200) {
              const err20 = {
                instancePath: instancePath + '/partI/physicalAddress',
                schemaPath: '#/properties/partI/properties/physicalAddress/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
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
              instancePath: instancePath + '/partI/physicalAddress',
              schemaPath: '#/properties/partI/properties/physicalAddress/type',
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
        if (data1.emailAddress !== undefined) {
          let data6 = data1.emailAddress;
          if (typeof data6 === 'string') {
            if (!formats0.test(data6)) {
              const err22 = {
                instancePath: instancePath + '/partI/emailAddress',
                schemaPath: '#/properties/partI/properties/emailAddress/format',
                keyword: 'format',
                params: { format: 'email' },
                message: 'must match format "' + 'email' + '"',
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
              instancePath: instancePath + '/partI/emailAddress',
              schemaPath: '#/properties/partI/properties/emailAddress/type',
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
        if (data1.period !== undefined) {
          let data7 = data1.period;
          if (data7 && typeof data7 == 'object' && !Array.isArray(data7)) {
            if (data7.from === undefined) {
              const err24 = {
                instancePath: instancePath + '/partI/period',
                schemaPath: '#/properties/partI/properties/period/required',
                keyword: 'required',
                params: { missingProperty: 'from' },
                message: "must have required property '" + 'from' + "'",
              };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
            if (data7.to === undefined) {
              const err25 = {
                instancePath: instancePath + '/partI/period',
                schemaPath: '#/properties/partI/properties/period/required',
                keyword: 'required',
                params: { missingProperty: 'to' },
                message: "must have required property '" + 'to' + "'",
              };
              if (vErrors === null) {
                vErrors = [err25];
              } else {
                vErrors.push(err25);
              }
              errors++;
            }
            if (data7.financialYearStart === undefined) {
              const err26 = {
                instancePath: instancePath + '/partI/period',
                schemaPath: '#/properties/partI/properties/period/required',
                keyword: 'required',
                params: { missingProperty: 'financialYearStart' },
                message: "must have required property '" + 'financialYearStart' + "'",
              };
              if (vErrors === null) {
                vErrors = [err26];
              } else {
                vErrors.push(err26);
              }
              errors++;
            }
            for (const key2 in data7) {
              if (!(key2 === 'from' || key2 === 'to' || key2 === 'financialYearStart')) {
                const err27 = {
                  instancePath: instancePath + '/partI/period',
                  schemaPath: '#/properties/partI/properties/period/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key2 },
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
            if (data7.from !== undefined) {
              let data8 = data7.from;
              if (typeof data8 === 'string') {
                if (!formats2.validate(data8)) {
                  const err28 = {
                    instancePath: instancePath + '/partI/period/from',
                    schemaPath: '#/properties/partI/properties/period/properties/from/format',
                    keyword: 'format',
                    params: { format: 'date' },
                    message: 'must match format "' + 'date' + '"',
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
                  instancePath: instancePath + '/partI/period/from',
                  schemaPath: '#/properties/partI/properties/period/properties/from/type',
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
            if (data7.to !== undefined) {
              let data9 = data7.to;
              if (typeof data9 === 'string') {
                if (!formats2.validate(data9)) {
                  const err30 = {
                    instancePath: instancePath + '/partI/period/to',
                    schemaPath: '#/properties/partI/properties/period/properties/to/format',
                    keyword: 'format',
                    params: { format: 'date' },
                    message: 'must match format "' + 'date' + '"',
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
                  instancePath: instancePath + '/partI/period/to',
                  schemaPath: '#/properties/partI/properties/period/properties/to/type',
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
            if (data7.financialYearStart !== undefined) {
              let data10 = data7.financialYearStart;
              if (!(
                typeof data10 == 'number' &&
                !(data10 % 1) &&
                !isNaN(data10) &&
                isFinite(data10)
              )) {
                const err32 = {
                  instancePath: instancePath + '/partI/period/financialYearStart',
                  schemaPath:
                    '#/properties/partI/properties/period/properties/financialYearStart/type',
                  keyword: 'type',
                  params: { type: 'integer' },
                  message: 'must be integer',
                };
                if (vErrors === null) {
                  vErrors = [err32];
                } else {
                  vErrors.push(err32);
                }
                errors++;
              }
              if (typeof data10 == 'number' && isFinite(data10)) {
                if (data10 < 2025 || isNaN(data10)) {
                  const err33 = {
                    instancePath: instancePath + '/partI/period/financialYearStart',
                    schemaPath:
                      '#/properties/partI/properties/period/properties/financialYearStart/minimum',
                    keyword: 'minimum',
                    params: { comparison: '>=', limit: 2025 },
                    message: 'must be >= 2025',
                  };
                  if (vErrors === null) {
                    vErrors = [err33];
                  } else {
                    vErrors.push(err33);
                  }
                  errors++;
                }
              }
            }
          } else {
            const err34 = {
              instancePath: instancePath + '/partI/period',
              schemaPath: '#/properties/partI/properties/period/type',
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
      } else {
        const err35 = {
          instancePath: instancePath + '/partI',
          schemaPath: '#/properties/partI/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err35];
        } else {
          vErrors.push(err35);
        }
        errors++;
      }
    }
    if (data.partII !== undefined) {
      let data11 = data.partII;
      if (data11 && typeof data11 == 'object' && !Array.isArray(data11)) {
        if (data11.initial === undefined) {
          const err36 = {
            instancePath: instancePath + '/partII',
            schemaPath: '#/properties/partII/required',
            keyword: 'required',
            params: { missingProperty: 'initial' },
            message: "must have required property '" + 'initial' + "'",
          };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
        if (data11.biennial === undefined) {
          const err37 = {
            instancePath: instancePath + '/partII',
            schemaPath: '#/properties/partII/required',
            keyword: 'required',
            params: { missingProperty: 'biennial' },
            message: "must have required property '" + 'biennial' + "'",
          };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
        if (data11.final === undefined) {
          const err38 = {
            instancePath: instancePath + '/partII',
            schemaPath: '#/properties/partII/required',
            keyword: 'required',
            params: { missingProperty: 'final' },
            message: "must have required property '" + 'final' + "'",
          };
          if (vErrors === null) {
            vErrors = [err38];
          } else {
            vErrors.push(err38);
          }
          errors++;
        }
        if (data11.clarifications === undefined) {
          const err39 = {
            instancePath: instancePath + '/partII',
            schemaPath: '#/properties/partII/required',
            keyword: 'required',
            params: { missingProperty: 'clarifications' },
            message: "must have required property '" + 'clarifications' + "'",
          };
          if (vErrors === null) {
            vErrors = [err39];
          } else {
            vErrors.push(err39);
          }
          errors++;
        }
        if (data11.accessRequests === undefined) {
          const err40 = {
            instancePath: instancePath + '/partII',
            schemaPath: '#/properties/partII/required',
            keyword: 'required',
            params: { missingProperty: 'accessRequests' },
            message: "must have required property '" + 'accessRequests' + "'",
          };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        if (data11.complaints === undefined) {
          const err41 = {
            instancePath: instancePath + '/partII',
            schemaPath: '#/properties/partII/required',
            keyword: 'required',
            params: { missingProperty: 'complaints' },
            message: "must have required property '" + 'complaints' + "'",
          };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
        for (const key3 in data11) {
          if (!(
            key3 === 'initial' ||
            key3 === 'biennial' ||
            key3 === 'final' ||
            key3 === 'clarifications' ||
            key3 === 'accessRequests' ||
            key3 === 'complaints'
          )) {
            const err42 = {
              instancePath: instancePath + '/partII',
              schemaPath: '#/properties/partII/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key3 },
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
        if (data11.initial !== undefined) {
          if (
            !validate21(data11.initial, {
              instancePath: instancePath + '/partII/initial',
              parentData: data11,
              parentDataProperty: 'initial',
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
            errors = vErrors.length;
          }
        }
        if (data11.biennial !== undefined) {
          let data13 = data11.biennial;
          if (
            !validate21(data13, {
              instancePath: instancePath + '/partII/biennial',
              parentData: data11,
              parentDataProperty: 'biennial',
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
            errors = vErrors.length;
          }
          if (data13 && typeof data13 == 'object' && !Array.isArray(data13)) {
            if (data13.noCycleInPeriod !== undefined) {
              if (typeof data13.noCycleInPeriod !== 'boolean') {
                const err43 = {
                  instancePath: instancePath + '/partII/biennial/noCycleInPeriod',
                  schemaPath:
                    '#/properties/partII/properties/biennial/allOf/1/properties/noCycleInPeriod/type',
                  keyword: 'type',
                  params: { type: 'boolean' },
                  message: 'must be boolean',
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
              instancePath: instancePath + '/partII/biennial',
              schemaPath: '#/properties/partII/properties/biennial/allOf/1/type',
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
        if (data11.final !== undefined) {
          if (
            !validate21(data11.final, {
              instancePath: instancePath + '/partII/final',
              parentData: data11,
              parentDataProperty: 'final',
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
            errors = vErrors.length;
          }
        }
        if (data11.clarifications !== undefined) {
          let data16 = data11.clarifications;
          if (data16 && typeof data16 == 'object' && !Array.isArray(data16)) {
            if (data16.items === undefined) {
              const err45 = {
                instancePath: instancePath + '/partII/clarifications',
                schemaPath: '#/properties/partII/properties/clarifications/required',
                keyword: 'required',
                params: { missingProperty: 'items' },
                message: "must have required property '" + 'items' + "'",
              };
              if (vErrors === null) {
                vErrors = [err45];
              } else {
                vErrors.push(err45);
              }
              errors++;
            }
            for (const key4 in data16) {
              if (!(key4 === 'items')) {
                const err46 = {
                  instancePath: instancePath + '/partII/clarifications',
                  schemaPath: '#/properties/partII/properties/clarifications/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key4 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err46];
                } else {
                  vErrors.push(err46);
                }
                errors++;
              }
            }
            if (data16.items !== undefined) {
              let data17 = data16.items;
              if (Array.isArray(data17)) {
                const len0 = data17.length;
                for (let i0 = 0; i0 < len0; i0++) {
                  let data18 = data17[i0];
                  if (data18 && typeof data18 == 'object' && !Array.isArray(data18)) {
                    if (data18.name === undefined) {
                      const err47 = {
                        instancePath: instancePath + '/partII/clarifications/items/' + i0,
                        schemaPath:
                          '#/properties/partII/properties/clarifications/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'name' },
                        message: "must have required property '" + 'name' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err47];
                      } else {
                        vErrors.push(err47);
                      }
                      errors++;
                    }
                    if (data18.designation === undefined) {
                      const err48 = {
                        instancePath: instancePath + '/partII/clarifications/items/' + i0,
                        schemaPath:
                          '#/properties/partII/properties/clarifications/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'designation' },
                        message: "must have required property '" + 'designation' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err48];
                      } else {
                        vErrors.push(err48);
                      }
                      errors++;
                    }
                    if (data18.identifier === undefined) {
                      const err49 = {
                        instancePath: instancePath + '/partII/clarifications/items/' + i0,
                        schemaPath:
                          '#/properties/partII/properties/clarifications/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'identifier' },
                        message: "must have required property '" + 'identifier' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err49];
                      } else {
                        vErrors.push(err49);
                      }
                      errors++;
                    }
                    if (data18.natureInGeneralTerms === undefined) {
                      const err50 = {
                        instancePath: instancePath + '/partII/clarifications/items/' + i0,
                        schemaPath:
                          '#/properties/partII/properties/clarifications/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'natureInGeneralTerms' },
                        message: "must have required property '" + 'natureInGeneralTerms' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err50];
                      } else {
                        vErrors.push(err50);
                      }
                      errors++;
                    }
                    if (data18.statusOfCompliance === undefined) {
                      const err51 = {
                        instancePath: instancePath + '/partII/clarifications/items/' + i0,
                        schemaPath:
                          '#/properties/partII/properties/clarifications/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'statusOfCompliance' },
                        message: "must have required property '" + 'statusOfCompliance' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err51];
                      } else {
                        vErrors.push(err51);
                      }
                      errors++;
                    }
                    for (const key5 in data18) {
                      if (!(
                        key5 === 'name' ||
                        key5 === 'designation' ||
                        key5 === 'identifier' ||
                        key5 === 'natureInGeneralTerms' ||
                        key5 === 'statusOfCompliance' ||
                        key5 === 'clarificationReference'
                      )) {
                        const err52 = {
                          instancePath: instancePath + '/partII/clarifications/items/' + i0,
                          schemaPath:
                            '#/properties/partII/properties/clarifications/properties/items/items/additionalProperties',
                          keyword: 'additionalProperties',
                          params: { additionalProperty: key5 },
                          message: 'must NOT have additional properties',
                        };
                        if (vErrors === null) {
                          vErrors = [err52];
                        } else {
                          vErrors.push(err52);
                        }
                        errors++;
                      }
                    }
                    if (data18.name !== undefined) {
                      if (typeof data18.name !== 'string') {
                        const err53 = {
                          instancePath:
                            instancePath + '/partII/clarifications/items/' + i0 + '/name',
                          schemaPath:
                            '#/properties/partII/properties/clarifications/properties/items/items/properties/name/type',
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
                    if (data18.designation !== undefined) {
                      if (typeof data18.designation !== 'string') {
                        const err54 = {
                          instancePath:
                            instancePath + '/partII/clarifications/items/' + i0 + '/designation',
                          schemaPath:
                            '#/properties/partII/properties/clarifications/properties/items/items/properties/designation/type',
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
                    if (data18.identifier !== undefined) {
                      if (typeof data18.identifier !== 'string') {
                        const err55 = {
                          instancePath:
                            instancePath + '/partII/clarifications/items/' + i0 + '/identifier',
                          schemaPath:
                            '#/properties/partII/properties/clarifications/properties/items/items/properties/identifier/type',
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
                    }
                    if (data18.natureInGeneralTerms !== undefined) {
                      let data22 = data18.natureInGeneralTerms;
                      if (typeof data22 === 'string') {
                        if (func1(data22) > 300) {
                          const err56 = {
                            instancePath:
                              instancePath +
                              '/partII/clarifications/items/' +
                              i0 +
                              '/natureInGeneralTerms',
                            schemaPath:
                              '#/properties/partII/properties/clarifications/properties/items/items/properties/natureInGeneralTerms/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 300 },
                            message: 'must NOT have more than 300 characters',
                          };
                          if (vErrors === null) {
                            vErrors = [err56];
                          } else {
                            vErrors.push(err56);
                          }
                          errors++;
                        }
                      } else {
                        const err57 = {
                          instancePath:
                            instancePath +
                            '/partII/clarifications/items/' +
                            i0 +
                            '/natureInGeneralTerms',
                          schemaPath:
                            '#/properties/partII/properties/clarifications/properties/items/items/properties/natureInGeneralTerms/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        };
                        if (vErrors === null) {
                          vErrors = [err57];
                        } else {
                          vErrors.push(err57);
                        }
                        errors++;
                      }
                    }
                    if (data18.statusOfCompliance !== undefined) {
                      let data23 = data18.statusOfCompliance;
                      if (typeof data23 !== 'string') {
                        const err58 = {
                          instancePath:
                            instancePath +
                            '/partII/clarifications/items/' +
                            i0 +
                            '/statusOfCompliance',
                          schemaPath:
                            '#/properties/partII/properties/clarifications/properties/items/items/properties/statusOfCompliance/type',
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
                      if (!(
                        data23 === 'responded' ||
                        data23 === 'resolved' ||
                        data23 === 'pending' ||
                        data23 === 'overdue' ||
                        data23 === 'withdrawn'
                      )) {
                        const err59 = {
                          instancePath:
                            instancePath +
                            '/partII/clarifications/items/' +
                            i0 +
                            '/statusOfCompliance',
                          schemaPath:
                            '#/properties/partII/properties/clarifications/properties/items/items/properties/statusOfCompliance/enum',
                          keyword: 'enum',
                          params: {
                            allowedValues:
                              schema31.properties.partII.properties.clarifications.properties.items
                                .items.properties.statusOfCompliance.enum,
                          },
                          message: 'must be equal to one of the allowed values',
                        };
                        if (vErrors === null) {
                          vErrors = [err59];
                        } else {
                          vErrors.push(err59);
                        }
                        errors++;
                      }
                    }
                    if (data18.clarificationReference !== undefined) {
                      if (typeof data18.clarificationReference !== 'string') {
                        const err60 = {
                          instancePath:
                            instancePath +
                            '/partII/clarifications/items/' +
                            i0 +
                            '/clarificationReference',
                          schemaPath:
                            '#/properties/partII/properties/clarifications/properties/items/items/properties/clarificationReference/type',
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
                  } else {
                    const err61 = {
                      instancePath: instancePath + '/partII/clarifications/items/' + i0,
                      schemaPath:
                        '#/properties/partII/properties/clarifications/properties/items/items/type',
                      keyword: 'type',
                      params: { type: 'object' },
                      message: 'must be object',
                    };
                    if (vErrors === null) {
                      vErrors = [err61];
                    } else {
                      vErrors.push(err61);
                    }
                    errors++;
                  }
                }
              } else {
                const err62 = {
                  instancePath: instancePath + '/partII/clarifications/items',
                  schemaPath: '#/properties/partII/properties/clarifications/properties/items/type',
                  keyword: 'type',
                  params: { type: 'array' },
                  message: 'must be array',
                };
                if (vErrors === null) {
                  vErrors = [err62];
                } else {
                  vErrors.push(err62);
                }
                errors++;
              }
            }
          } else {
            const err63 = {
              instancePath: instancePath + '/partII/clarifications',
              schemaPath: '#/properties/partII/properties/clarifications/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
        }
        if (data11.accessRequests !== undefined) {
          let data25 = data11.accessRequests;
          if (data25 && typeof data25 == 'object' && !Array.isArray(data25)) {
            if (data25.received === undefined) {
              const err64 = {
                instancePath: instancePath + '/partII/accessRequests',
                schemaPath: '#/properties/partII/properties/accessRequests/required',
                keyword: 'required',
                params: { missingProperty: 'received' },
                message: "must have required property '" + 'received' + "'",
              };
              if (vErrors === null) {
                vErrors = [err64];
              } else {
                vErrors.push(err64);
              }
              errors++;
            }
            if (data25.granted === undefined) {
              const err65 = {
                instancePath: instancePath + '/partII/accessRequests',
                schemaPath: '#/properties/partII/properties/accessRequests/required',
                keyword: 'required',
                params: { missingProperty: 'granted' },
                message: "must have required property '" + 'granted' + "'",
              };
              if (vErrors === null) {
                vErrors = [err65];
              } else {
                vErrors.push(err65);
              }
              errors++;
            }
            if (data25.declined === undefined) {
              const err66 = {
                instancePath: instancePath + '/partII/accessRequests',
                schemaPath: '#/properties/partII/properties/accessRequests/required',
                keyword: 'required',
                params: { missingProperty: 'declined' },
                message: "must have required property '" + 'declined' + "'",
              };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
            if (data25.declineReasons === undefined) {
              const err67 = {
                instancePath: instancePath + '/partII/accessRequests',
                schemaPath: '#/properties/partII/properties/accessRequests/required',
                keyword: 'required',
                params: { missingProperty: 'declineReasons' },
                message: "must have required property '" + 'declineReasons' + "'",
              };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
            if (data25.dataUnavailable === undefined) {
              const err68 = {
                instancePath: instancePath + '/partII/accessRequests',
                schemaPath: '#/properties/partII/properties/accessRequests/required',
                keyword: 'required',
                params: { missingProperty: 'dataUnavailable' },
                message: "must have required property '" + 'dataUnavailable' + "'",
              };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
            }
            for (const key6 in data25) {
              if (!(
                key6 === 'received' ||
                key6 === 'granted' ||
                key6 === 'declined' ||
                key6 === 'declineReasons' ||
                key6 === 'dataUnavailable'
              )) {
                const err69 = {
                  instancePath: instancePath + '/partII/accessRequests',
                  schemaPath: '#/properties/partII/properties/accessRequests/additionalProperties',
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
            if (data25.received !== undefined) {
              let data26 = data25.received;
              if (!(
                typeof data26 == 'number' &&
                !(data26 % 1) &&
                !isNaN(data26) &&
                isFinite(data26)
              )) {
                const err70 = {
                  instancePath: instancePath + '/partII/accessRequests/received',
                  schemaPath:
                    '#/properties/partII/properties/accessRequests/properties/received/type',
                  keyword: 'type',
                  params: { type: 'integer' },
                  message: 'must be integer',
                };
                if (vErrors === null) {
                  vErrors = [err70];
                } else {
                  vErrors.push(err70);
                }
                errors++;
              }
              if (typeof data26 == 'number' && isFinite(data26)) {
                if (data26 < 0 || isNaN(data26)) {
                  const err71 = {
                    instancePath: instancePath + '/partII/accessRequests/received',
                    schemaPath:
                      '#/properties/partII/properties/accessRequests/properties/received/minimum',
                    keyword: 'minimum',
                    params: { comparison: '>=', limit: 0 },
                    message: 'must be >= 0',
                  };
                  if (vErrors === null) {
                    vErrors = [err71];
                  } else {
                    vErrors.push(err71);
                  }
                  errors++;
                }
              }
            }
            if (data25.granted !== undefined) {
              let data27 = data25.granted;
              if (!(
                typeof data27 == 'number' &&
                !(data27 % 1) &&
                !isNaN(data27) &&
                isFinite(data27)
              )) {
                const err72 = {
                  instancePath: instancePath + '/partII/accessRequests/granted',
                  schemaPath:
                    '#/properties/partII/properties/accessRequests/properties/granted/type',
                  keyword: 'type',
                  params: { type: 'integer' },
                  message: 'must be integer',
                };
                if (vErrors === null) {
                  vErrors = [err72];
                } else {
                  vErrors.push(err72);
                }
                errors++;
              }
              if (typeof data27 == 'number' && isFinite(data27)) {
                if (data27 < 0 || isNaN(data27)) {
                  const err73 = {
                    instancePath: instancePath + '/partII/accessRequests/granted',
                    schemaPath:
                      '#/properties/partII/properties/accessRequests/properties/granted/minimum',
                    keyword: 'minimum',
                    params: { comparison: '>=', limit: 0 },
                    message: 'must be >= 0',
                  };
                  if (vErrors === null) {
                    vErrors = [err73];
                  } else {
                    vErrors.push(err73);
                  }
                  errors++;
                }
              }
            }
            if (data25.declined !== undefined) {
              let data28 = data25.declined;
              if (!(
                typeof data28 == 'number' &&
                !(data28 % 1) &&
                !isNaN(data28) &&
                isFinite(data28)
              )) {
                const err74 = {
                  instancePath: instancePath + '/partII/accessRequests/declined',
                  schemaPath:
                    '#/properties/partII/properties/accessRequests/properties/declined/type',
                  keyword: 'type',
                  params: { type: 'integer' },
                  message: 'must be integer',
                };
                if (vErrors === null) {
                  vErrors = [err74];
                } else {
                  vErrors.push(err74);
                }
                errors++;
              }
              if (typeof data28 == 'number' && isFinite(data28)) {
                if (data28 < 0 || isNaN(data28)) {
                  const err75 = {
                    instancePath: instancePath + '/partII/accessRequests/declined',
                    schemaPath:
                      '#/properties/partII/properties/accessRequests/properties/declined/minimum',
                    keyword: 'minimum',
                    params: { comparison: '>=', limit: 0 },
                    message: 'must be >= 0',
                  };
                  if (vErrors === null) {
                    vErrors = [err75];
                  } else {
                    vErrors.push(err75);
                  }
                  errors++;
                }
              }
            }
            if (data25.declineReasons !== undefined) {
              let data29 = data25.declineReasons;
              if (Array.isArray(data29)) {
                const len1 = data29.length;
                for (let i1 = 0; i1 < len1; i1++) {
                  let data30 = data29[i1];
                  if (data30 && typeof data30 == 'object' && !Array.isArray(data30)) {
                    if (data30.reason === undefined) {
                      const err76 = {
                        instancePath: instancePath + '/partII/accessRequests/declineReasons/' + i1,
                        schemaPath:
                          '#/properties/partII/properties/accessRequests/properties/declineReasons/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'reason' },
                        message: "must have required property '" + 'reason' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err76];
                      } else {
                        vErrors.push(err76);
                      }
                      errors++;
                    }
                    if (data30.count === undefined) {
                      const err77 = {
                        instancePath: instancePath + '/partII/accessRequests/declineReasons/' + i1,
                        schemaPath:
                          '#/properties/partII/properties/accessRequests/properties/declineReasons/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'count' },
                        message: "must have required property '" + 'count' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err77];
                      } else {
                        vErrors.push(err77);
                      }
                      errors++;
                    }
                    for (const key7 in data30) {
                      if (!(key7 === 'reason' || key7 === 'count')) {
                        const err78 = {
                          instancePath:
                            instancePath + '/partII/accessRequests/declineReasons/' + i1,
                          schemaPath:
                            '#/properties/partII/properties/accessRequests/properties/declineReasons/items/additionalProperties',
                          keyword: 'additionalProperties',
                          params: { additionalProperty: key7 },
                          message: 'must NOT have additional properties',
                        };
                        if (vErrors === null) {
                          vErrors = [err78];
                        } else {
                          vErrors.push(err78);
                        }
                        errors++;
                      }
                    }
                    if (data30.reason !== undefined) {
                      let data31 = data30.reason;
                      if (typeof data31 !== 'string') {
                        const err79 = {
                          instancePath:
                            instancePath +
                            '/partII/accessRequests/declineReasons/' +
                            i1 +
                            '/reason',
                          schemaPath:
                            '#/properties/partII/properties/accessRequests/properties/declineReasons/items/properties/reason/type',
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
                        data31 === 'public-interest' ||
                        data31 === 'prejudice-proceeding' ||
                        data31 === 'frivolous-vexatious' ||
                        data31 === 'not-objectives' ||
                        data31 === 'other'
                      )) {
                        const err80 = {
                          instancePath:
                            instancePath +
                            '/partII/accessRequests/declineReasons/' +
                            i1 +
                            '/reason',
                          schemaPath:
                            '#/properties/partII/properties/accessRequests/properties/declineReasons/items/properties/reason/enum',
                          keyword: 'enum',
                          params: {
                            allowedValues:
                              schema31.properties.partII.properties.accessRequests.properties
                                .declineReasons.items.properties.reason.enum,
                          },
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
                    if (data30.count !== undefined) {
                      let data32 = data30.count;
                      if (!(
                        typeof data32 == 'number' &&
                        !(data32 % 1) &&
                        !isNaN(data32) &&
                        isFinite(data32)
                      )) {
                        const err81 = {
                          instancePath:
                            instancePath + '/partII/accessRequests/declineReasons/' + i1 + '/count',
                          schemaPath:
                            '#/properties/partII/properties/accessRequests/properties/declineReasons/items/properties/count/type',
                          keyword: 'type',
                          params: { type: 'integer' },
                          message: 'must be integer',
                        };
                        if (vErrors === null) {
                          vErrors = [err81];
                        } else {
                          vErrors.push(err81);
                        }
                        errors++;
                      }
                      if (typeof data32 == 'number' && isFinite(data32)) {
                        if (data32 < 0 || isNaN(data32)) {
                          const err82 = {
                            instancePath:
                              instancePath +
                              '/partII/accessRequests/declineReasons/' +
                              i1 +
                              '/count',
                            schemaPath:
                              '#/properties/partII/properties/accessRequests/properties/declineReasons/items/properties/count/minimum',
                            keyword: 'minimum',
                            params: { comparison: '>=', limit: 0 },
                            message: 'must be >= 0',
                          };
                          if (vErrors === null) {
                            vErrors = [err82];
                          } else {
                            vErrors.push(err82);
                          }
                          errors++;
                        }
                      }
                    }
                  } else {
                    const err83 = {
                      instancePath: instancePath + '/partII/accessRequests/declineReasons/' + i1,
                      schemaPath:
                        '#/properties/partII/properties/accessRequests/properties/declineReasons/items/type',
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
                  instancePath: instancePath + '/partII/accessRequests/declineReasons',
                  schemaPath:
                    '#/properties/partII/properties/accessRequests/properties/declineReasons/type',
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
            if (data25.dataUnavailable !== undefined) {
              if (typeof data25.dataUnavailable !== 'boolean') {
                const err85 = {
                  instancePath: instancePath + '/partII/accessRequests/dataUnavailable',
                  schemaPath:
                    '#/properties/partII/properties/accessRequests/properties/dataUnavailable/type',
                  keyword: 'type',
                  params: { type: 'boolean' },
                  message: 'must be boolean',
                };
                if (vErrors === null) {
                  vErrors = [err85];
                } else {
                  vErrors.push(err85);
                }
                errors++;
              }
            }
          } else {
            const err86 = {
              instancePath: instancePath + '/partII/accessRequests',
              schemaPath: '#/properties/partII/properties/accessRequests/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err86];
            } else {
              vErrors.push(err86);
            }
            errors++;
          }
        }
        if (data11.complaints !== undefined) {
          let data34 = data11.complaints;
          if (data34 && typeof data34 == 'object' && !Array.isArray(data34)) {
            if (data34.registerMaintained === undefined) {
              const err87 = {
                instancePath: instancePath + '/partII/complaints',
                schemaPath: '#/properties/partII/properties/complaints/required',
                keyword: 'required',
                params: { missingProperty: 'registerMaintained' },
                message: "must have required property '" + 'registerMaintained' + "'",
              };
              if (vErrors === null) {
                vErrors = [err87];
              } else {
                vErrors.push(err87);
              }
              errors++;
            }
            if (data34.items === undefined) {
              const err88 = {
                instancePath: instancePath + '/partII/complaints',
                schemaPath: '#/properties/partII/properties/complaints/required',
                keyword: 'required',
                params: { missingProperty: 'items' },
                message: "must have required property '" + 'items' + "'",
              };
              if (vErrors === null) {
                vErrors = [err88];
              } else {
                vErrors.push(err88);
              }
              errors++;
            }
            for (const key8 in data34) {
              if (!(key8 === 'registerMaintained' || key8 === 'items')) {
                const err89 = {
                  instancePath: instancePath + '/partII/complaints',
                  schemaPath: '#/properties/partII/properties/complaints/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key8 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err89];
                } else {
                  vErrors.push(err89);
                }
                errors++;
              }
            }
            if (data34.registerMaintained !== undefined) {
              let data35 = data34.registerMaintained;
              if (typeof data35 !== 'boolean' && data35 !== null) {
                const err90 = {
                  instancePath: instancePath + '/partII/complaints/registerMaintained',
                  schemaPath:
                    '#/properties/partII/properties/complaints/properties/registerMaintained/type',
                  keyword: 'type',
                  params: {
                    type: schema31.properties.partII.properties.complaints.properties
                      .registerMaintained.type,
                  },
                  message: 'must be boolean,null',
                };
                if (vErrors === null) {
                  vErrors = [err90];
                } else {
                  vErrors.push(err90);
                }
                errors++;
              }
            }
            if (data34.items !== undefined) {
              let data36 = data34.items;
              if (Array.isArray(data36)) {
                const len2 = data36.length;
                for (let i2 = 0; i2 < len2; i2++) {
                  let data37 = data36[i2];
                  if (data37 && typeof data37 == 'object' && !Array.isArray(data37)) {
                    if (data37.name === undefined) {
                      const err91 = {
                        instancePath: instancePath + '/partII/complaints/items/' + i2,
                        schemaPath:
                          '#/properties/partII/properties/complaints/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'name' },
                        message: "must have required property '" + 'name' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err91];
                      } else {
                        vErrors.push(err91);
                      }
                      errors++;
                    }
                    if (data37.designation === undefined) {
                      const err92 = {
                        instancePath: instancePath + '/partII/complaints/items/' + i2,
                        schemaPath:
                          '#/properties/partII/properties/complaints/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'designation' },
                        message: "must have required property '" + 'designation' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err92];
                      } else {
                        vErrors.push(err92);
                      }
                      errors++;
                    }
                    if (data37.identifier === undefined) {
                      const err93 = {
                        instancePath: instancePath + '/partII/complaints/items/' + i2,
                        schemaPath:
                          '#/properties/partII/properties/complaints/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'identifier' },
                        message: "must have required property '" + 'identifier' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err93];
                      } else {
                        vErrors.push(err93);
                      }
                      errors++;
                    }
                    if (data37.nature === undefined) {
                      const err94 = {
                        instancePath: instancePath + '/partII/complaints/items/' + i2,
                        schemaPath:
                          '#/properties/partII/properties/complaints/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'nature' },
                        message: "must have required property '" + 'nature' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err94];
                      } else {
                        vErrors.push(err94);
                      }
                      errors++;
                    }
                    if (data37.status === undefined) {
                      const err95 = {
                        instancePath: instancePath + '/partII/complaints/items/' + i2,
                        schemaPath:
                          '#/properties/partII/properties/complaints/properties/items/items/required',
                        keyword: 'required',
                        params: { missingProperty: 'status' },
                        message: "must have required property '" + 'status' + "'",
                      };
                      if (vErrors === null) {
                        vErrors = [err95];
                      } else {
                        vErrors.push(err95);
                      }
                      errors++;
                    }
                    for (const key9 in data37) {
                      if (!(
                        key9 === 'name' ||
                        key9 === 'designation' ||
                        key9 === 'identifier' ||
                        key9 === 'nature' ||
                        key9 === 'status'
                      )) {
                        const err96 = {
                          instancePath: instancePath + '/partII/complaints/items/' + i2,
                          schemaPath:
                            '#/properties/partII/properties/complaints/properties/items/items/additionalProperties',
                          keyword: 'additionalProperties',
                          params: { additionalProperty: key9 },
                          message: 'must NOT have additional properties',
                        };
                        if (vErrors === null) {
                          vErrors = [err96];
                        } else {
                          vErrors.push(err96);
                        }
                        errors++;
                      }
                    }
                    if (data37.name !== undefined) {
                      if (typeof data37.name !== 'string') {
                        const err97 = {
                          instancePath: instancePath + '/partII/complaints/items/' + i2 + '/name',
                          schemaPath:
                            '#/properties/partII/properties/complaints/properties/items/items/properties/name/type',
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
                    if (data37.designation !== undefined) {
                      if (typeof data37.designation !== 'string') {
                        const err98 = {
                          instancePath:
                            instancePath + '/partII/complaints/items/' + i2 + '/designation',
                          schemaPath:
                            '#/properties/partII/properties/complaints/properties/items/items/properties/designation/type',
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
                    if (data37.identifier !== undefined) {
                      if (typeof data37.identifier !== 'string') {
                        const err99 = {
                          instancePath:
                            instancePath + '/partII/complaints/items/' + i2 + '/identifier',
                          schemaPath:
                            '#/properties/partII/properties/complaints/properties/items/items/properties/identifier/type',
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
                    if (data37.nature !== undefined) {
                      let data41 = data37.nature;
                      if (typeof data41 === 'string') {
                        if (func1(data41) > 300) {
                          const err100 = {
                            instancePath:
                              instancePath + '/partII/complaints/items/' + i2 + '/nature',
                            schemaPath:
                              '#/properties/partII/properties/complaints/properties/items/items/properties/nature/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 300 },
                            message: 'must NOT have more than 300 characters',
                          };
                          if (vErrors === null) {
                            vErrors = [err100];
                          } else {
                            vErrors.push(err100);
                          }
                          errors++;
                        }
                      } else {
                        const err101 = {
                          instancePath: instancePath + '/partII/complaints/items/' + i2 + '/nature',
                          schemaPath:
                            '#/properties/partII/properties/complaints/properties/items/items/properties/nature/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        };
                        if (vErrors === null) {
                          vErrors = [err101];
                        } else {
                          vErrors.push(err101);
                        }
                        errors++;
                      }
                    }
                    if (data37.status !== undefined) {
                      let data42 = data37.status;
                      if (typeof data42 === 'string') {
                        if (func1(data42) > 100) {
                          const err102 = {
                            instancePath:
                              instancePath + '/partII/complaints/items/' + i2 + '/status',
                            schemaPath:
                              '#/properties/partII/properties/complaints/properties/items/items/properties/status/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 100 },
                            message: 'must NOT have more than 100 characters',
                          };
                          if (vErrors === null) {
                            vErrors = [err102];
                          } else {
                            vErrors.push(err102);
                          }
                          errors++;
                        }
                      } else {
                        const err103 = {
                          instancePath: instancePath + '/partII/complaints/items/' + i2 + '/status',
                          schemaPath:
                            '#/properties/partII/properties/complaints/properties/items/items/properties/status/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        };
                        if (vErrors === null) {
                          vErrors = [err103];
                        } else {
                          vErrors.push(err103);
                        }
                        errors++;
                      }
                    }
                  } else {
                    const err104 = {
                      instancePath: instancePath + '/partII/complaints/items/' + i2,
                      schemaPath:
                        '#/properties/partII/properties/complaints/properties/items/items/type',
                      keyword: 'type',
                      params: { type: 'object' },
                      message: 'must be object',
                    };
                    if (vErrors === null) {
                      vErrors = [err104];
                    } else {
                      vErrors.push(err104);
                    }
                    errors++;
                  }
                }
              } else {
                const err105 = {
                  instancePath: instancePath + '/partII/complaints/items',
                  schemaPath: '#/properties/partII/properties/complaints/properties/items/type',
                  keyword: 'type',
                  params: { type: 'array' },
                  message: 'must be array',
                };
                if (vErrors === null) {
                  vErrors = [err105];
                } else {
                  vErrors.push(err105);
                }
                errors++;
              }
            }
          } else {
            const err106 = {
              instancePath: instancePath + '/partII/complaints',
              schemaPath: '#/properties/partII/properties/complaints/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
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
          instancePath: instancePath + '/partII',
          schemaPath: '#/properties/partII/type',
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
    if (data.partIII !== undefined) {
      let data43 = data.partIII;
      if (data43 && typeof data43 == 'object' && !Array.isArray(data43)) {
        if (data43.compiledBy === undefined) {
          const err108 = {
            instancePath: instancePath + '/partIII',
            schemaPath: '#/properties/partIII/required',
            keyword: 'required',
            params: { missingProperty: 'compiledBy' },
            message: "must have required property '" + 'compiledBy' + "'",
          };
          if (vErrors === null) {
            vErrors = [err108];
          } else {
            vErrors.push(err108);
          }
          errors++;
        }
        if (data43.confirmedBy === undefined) {
          const err109 = {
            instancePath: instancePath + '/partIII',
            schemaPath: '#/properties/partIII/required',
            keyword: 'required',
            params: { missingProperty: 'confirmedBy' },
            message: "must have required property '" + 'confirmedBy' + "'",
          };
          if (vErrors === null) {
            vErrors = [err109];
          } else {
            vErrors.push(err109);
          }
          errors++;
        }
        for (const key10 in data43) {
          if (!(key10 === 'compiledBy' || key10 === 'confirmedBy')) {
            const err110 = {
              instancePath: instancePath + '/partIII',
              schemaPath: '#/properties/partIII/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key10 },
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
        if (data43.compiledBy !== undefined) {
          let data44 = data43.compiledBy;
          if (data44 && typeof data44 == 'object' && !Array.isArray(data44)) {
            if (data44.name === undefined) {
              const err111 = {
                instancePath: instancePath + '/partIII/compiledBy',
                schemaPath: '#/$defs/Signatory/required',
                keyword: 'required',
                params: { missingProperty: 'name' },
                message: "must have required property '" + 'name' + "'",
              };
              if (vErrors === null) {
                vErrors = [err111];
              } else {
                vErrors.push(err111);
              }
              errors++;
            }
            if (data44.designation === undefined) {
              const err112 = {
                instancePath: instancePath + '/partIII/compiledBy',
                schemaPath: '#/$defs/Signatory/required',
                keyword: 'required',
                params: { missingProperty: 'designation' },
                message: "must have required property '" + 'designation' + "'",
              };
              if (vErrors === null) {
                vErrors = [err112];
              } else {
                vErrors.push(err112);
              }
              errors++;
            }
            if (data44.date === undefined) {
              const err113 = {
                instancePath: instancePath + '/partIII/compiledBy',
                schemaPath: '#/$defs/Signatory/required',
                keyword: 'required',
                params: { missingProperty: 'date' },
                message: "must have required property '" + 'date' + "'",
              };
              if (vErrors === null) {
                vErrors = [err113];
              } else {
                vErrors.push(err113);
              }
              errors++;
            }
            for (const key11 in data44) {
              if (!(key11 === 'name' || key11 === 'designation' || key11 === 'date')) {
                const err114 = {
                  instancePath: instancePath + '/partIII/compiledBy',
                  schemaPath: '#/$defs/Signatory/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key11 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err114];
                } else {
                  vErrors.push(err114);
                }
                errors++;
              }
            }
            if (data44.name !== undefined) {
              let data45 = data44.name;
              if (typeof data45 !== 'string' && data45 !== null) {
                const err115 = {
                  instancePath: instancePath + '/partIII/compiledBy/name',
                  schemaPath: '#/$defs/Signatory/properties/name/type',
                  keyword: 'type',
                  params: { type: schema34.properties.name.type },
                  message: 'must be string,null',
                };
                if (vErrors === null) {
                  vErrors = [err115];
                } else {
                  vErrors.push(err115);
                }
                errors++;
              }
              if (typeof data45 === 'string') {
                if (func1(data45) > 200) {
                  const err116 = {
                    instancePath: instancePath + '/partIII/compiledBy/name',
                    schemaPath: '#/$defs/Signatory/properties/name/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 200 },
                    message: 'must NOT have more than 200 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err116];
                  } else {
                    vErrors.push(err116);
                  }
                  errors++;
                }
              }
            }
            if (data44.designation !== undefined) {
              let data46 = data44.designation;
              if (typeof data46 !== 'string' && data46 !== null) {
                const err117 = {
                  instancePath: instancePath + '/partIII/compiledBy/designation',
                  schemaPath: '#/$defs/Signatory/properties/designation/type',
                  keyword: 'type',
                  params: { type: schema34.properties.designation.type },
                  message: 'must be string,null',
                };
                if (vErrors === null) {
                  vErrors = [err117];
                } else {
                  vErrors.push(err117);
                }
                errors++;
              }
              if (typeof data46 === 'string') {
                if (func1(data46) > 100) {
                  const err118 = {
                    instancePath: instancePath + '/partIII/compiledBy/designation',
                    schemaPath: '#/$defs/Signatory/properties/designation/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err118];
                  } else {
                    vErrors.push(err118);
                  }
                  errors++;
                }
              }
            }
            if (data44.date !== undefined) {
              let data47 = data44.date;
              if (typeof data47 !== 'string' && data47 !== null) {
                const err119 = {
                  instancePath: instancePath + '/partIII/compiledBy/date',
                  schemaPath: '#/$defs/Signatory/properties/date/type',
                  keyword: 'type',
                  params: { type: schema34.properties.date.type },
                  message: 'must be string,null',
                };
                if (vErrors === null) {
                  vErrors = [err119];
                } else {
                  vErrors.push(err119);
                }
                errors++;
              }
              if (typeof data47 === 'string') {
                if (!formats2.validate(data47)) {
                  const err120 = {
                    instancePath: instancePath + '/partIII/compiledBy/date',
                    schemaPath: '#/$defs/Signatory/properties/date/format',
                    keyword: 'format',
                    params: { format: 'date' },
                    message: 'must match format "' + 'date' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err120];
                  } else {
                    vErrors.push(err120);
                  }
                  errors++;
                }
              }
            }
          } else {
            const err121 = {
              instancePath: instancePath + '/partIII/compiledBy',
              schemaPath: '#/$defs/Signatory/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err121];
            } else {
              vErrors.push(err121);
            }
            errors++;
          }
        }
        if (data43.confirmedBy !== undefined) {
          let data48 = data43.confirmedBy;
          if (data48 && typeof data48 == 'object' && !Array.isArray(data48)) {
            if (data48.name === undefined) {
              const err122 = {
                instancePath: instancePath + '/partIII/confirmedBy',
                schemaPath: '#/$defs/Signatory/required',
                keyword: 'required',
                params: { missingProperty: 'name' },
                message: "must have required property '" + 'name' + "'",
              };
              if (vErrors === null) {
                vErrors = [err122];
              } else {
                vErrors.push(err122);
              }
              errors++;
            }
            if (data48.designation === undefined) {
              const err123 = {
                instancePath: instancePath + '/partIII/confirmedBy',
                schemaPath: '#/$defs/Signatory/required',
                keyword: 'required',
                params: { missingProperty: 'designation' },
                message: "must have required property '" + 'designation' + "'",
              };
              if (vErrors === null) {
                vErrors = [err123];
              } else {
                vErrors.push(err123);
              }
              errors++;
            }
            if (data48.date === undefined) {
              const err124 = {
                instancePath: instancePath + '/partIII/confirmedBy',
                schemaPath: '#/$defs/Signatory/required',
                keyword: 'required',
                params: { missingProperty: 'date' },
                message: "must have required property '" + 'date' + "'",
              };
              if (vErrors === null) {
                vErrors = [err124];
              } else {
                vErrors.push(err124);
              }
              errors++;
            }
            for (const key12 in data48) {
              if (!(key12 === 'name' || key12 === 'designation' || key12 === 'date')) {
                const err125 = {
                  instancePath: instancePath + '/partIII/confirmedBy',
                  schemaPath: '#/$defs/Signatory/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key12 },
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
            if (data48.name !== undefined) {
              let data49 = data48.name;
              if (typeof data49 !== 'string' && data49 !== null) {
                const err126 = {
                  instancePath: instancePath + '/partIII/confirmedBy/name',
                  schemaPath: '#/$defs/Signatory/properties/name/type',
                  keyword: 'type',
                  params: { type: schema34.properties.name.type },
                  message: 'must be string,null',
                };
                if (vErrors === null) {
                  vErrors = [err126];
                } else {
                  vErrors.push(err126);
                }
                errors++;
              }
              if (typeof data49 === 'string') {
                if (func1(data49) > 200) {
                  const err127 = {
                    instancePath: instancePath + '/partIII/confirmedBy/name',
                    schemaPath: '#/$defs/Signatory/properties/name/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 200 },
                    message: 'must NOT have more than 200 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err127];
                  } else {
                    vErrors.push(err127);
                  }
                  errors++;
                }
              }
            }
            if (data48.designation !== undefined) {
              let data50 = data48.designation;
              if (typeof data50 !== 'string' && data50 !== null) {
                const err128 = {
                  instancePath: instancePath + '/partIII/confirmedBy/designation',
                  schemaPath: '#/$defs/Signatory/properties/designation/type',
                  keyword: 'type',
                  params: { type: schema34.properties.designation.type },
                  message: 'must be string,null',
                };
                if (vErrors === null) {
                  vErrors = [err128];
                } else {
                  vErrors.push(err128);
                }
                errors++;
              }
              if (typeof data50 === 'string') {
                if (func1(data50) > 100) {
                  const err129 = {
                    instancePath: instancePath + '/partIII/confirmedBy/designation',
                    schemaPath: '#/$defs/Signatory/properties/designation/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 100 },
                    message: 'must NOT have more than 100 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err129];
                  } else {
                    vErrors.push(err129);
                  }
                  errors++;
                }
              }
            }
            if (data48.date !== undefined) {
              let data51 = data48.date;
              if (typeof data51 !== 'string' && data51 !== null) {
                const err130 = {
                  instancePath: instancePath + '/partIII/confirmedBy/date',
                  schemaPath: '#/$defs/Signatory/properties/date/type',
                  keyword: 'type',
                  params: { type: schema34.properties.date.type },
                  message: 'must be string,null',
                };
                if (vErrors === null) {
                  vErrors = [err130];
                } else {
                  vErrors.push(err130);
                }
                errors++;
              }
              if (typeof data51 === 'string') {
                if (!formats2.validate(data51)) {
                  const err131 = {
                    instancePath: instancePath + '/partIII/confirmedBy/date',
                    schemaPath: '#/$defs/Signatory/properties/date/format',
                    keyword: 'format',
                    params: { format: 'date' },
                    message: 'must match format "' + 'date' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err131];
                  } else {
                    vErrors.push(err131);
                  }
                  errors++;
                }
              }
            }
          } else {
            const err132 = {
              instancePath: instancePath + '/partIII/confirmedBy',
              schemaPath: '#/$defs/Signatory/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err132];
            } else {
              vErrors.push(err132);
            }
            errors++;
          }
        }
      } else {
        const err133 = {
          instancePath: instancePath + '/partIII',
          schemaPath: '#/properties/partIII/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err133];
        } else {
          vErrors.push(err133);
        }
        errors++;
      }
    }
    if (data.meta !== undefined) {
      let data52 = data.meta;
      if (data52 && typeof data52 == 'object' && !Array.isArray(data52)) {
        for (const key13 in data52) {
          if (!(key13 === 'compiledAt' || key13 === 'reference' || key13 === 'source')) {
            const err134 = {
              instancePath: instancePath + '/meta',
              schemaPath: '#/properties/meta/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key13 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err134];
            } else {
              vErrors.push(err134);
            }
            errors++;
          }
        }
        if (data52.compiledAt !== undefined) {
          let data53 = data52.compiledAt;
          if (typeof data53 === 'string') {
            if (!formats14.validate(data53)) {
              const err135 = {
                instancePath: instancePath + '/meta/compiledAt',
                schemaPath: '#/properties/meta/properties/compiledAt/format',
                keyword: 'format',
                params: { format: 'date-time' },
                message: 'must match format "' + 'date-time' + '"',
              };
              if (vErrors === null) {
                vErrors = [err135];
              } else {
                vErrors.push(err135);
              }
              errors++;
            }
          } else {
            const err136 = {
              instancePath: instancePath + '/meta/compiledAt',
              schemaPath: '#/properties/meta/properties/compiledAt/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err136];
            } else {
              vErrors.push(err136);
            }
            errors++;
          }
        }
        if (data52.reference !== undefined) {
          if (typeof data52.reference !== 'string') {
            const err137 = {
              instancePath: instancePath + '/meta/reference',
              schemaPath: '#/properties/meta/properties/reference/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err137];
            } else {
              vErrors.push(err137);
            }
            errors++;
          }
        }
        if (data52.source !== undefined) {
          let data55 = data52.source;
          if (typeof data55 !== 'string') {
            const err138 = {
              instancePath: instancePath + '/meta/source',
              schemaPath: '#/properties/meta/properties/source/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err138];
            } else {
              vErrors.push(err138);
            }
            errors++;
          }
          if (!(data55 === 'hosted' || data55 === 'federated')) {
            const err139 = {
              instancePath: instancePath + '/meta/source',
              schemaPath: '#/properties/meta/properties/source/enum',
              keyword: 'enum',
              params: { allowedValues: schema31.properties.meta.properties.source.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err139];
            } else {
              vErrors.push(err139);
            }
            errors++;
          }
        }
      } else {
        const err140 = {
          instancePath: instancePath + '/meta',
          schemaPath: '#/properties/meta/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err140];
        } else {
          vErrors.push(err140);
        }
        errors++;
      }
    }
  } else {
    const err141 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err141];
    } else {
      vErrors.push(err141);
    }
    errors++;
  }
  validate20.errors = vErrors;
  return errors === 0;
}
validate20.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
