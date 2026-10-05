/* Generated from @adili/schemas/forms/form-k.v1.json by scripts/generate-validators.ts. Do not edit. */
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
export const formK = validate20;
const schema31 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://adili.go.ke/schemas/form-k.v1.json',
  title: 'Form K: Request to access a declaration or clarification (Regs r.22(1))',
  description:
    "The prescribed Form K: Part I applicant, Part II the public officer whose declaration is sought, Part III information sought, Part IV declaration of truth; plus the platform's scope fields. Draft: spec 10.",
  type: 'object',
  required: [
    'schemaVersion',
    'responsibleCommission',
    'partI',
    'partII',
    'partIII',
    'partIV',
    'scope',
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 'form-k.v1' },
    responsibleCommission: {
      type: 'string',
      description: 'Tenant key of the Responsible Commission addressed',
      pattern: '^[a-z][a-z0-9]{1,19}$',
    },
    partI: {
      type: 'object',
      description: 'Information on applicant',
      required: [
        'name',
        'identityDocument',
        'postalAddress',
        'physicalAddress',
        'telephone',
        'email',
        'occupation',
      ],
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          minLength: 2,
          maxLength: 200,
          description: 'Person or entity applying',
        },
        identityDocument: {
          type: 'object',
          required: ['kind', 'number'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['national-id', 'passport'] },
            number: { type: 'string', minLength: 5, maxLength: 20 },
            country: {
              type: 'string',
              pattern: '^[A-Z]{2}$',
              description: 'Issuing country for passports',
            },
          },
        },
        postalAddress: { type: 'string', minLength: 3, maxLength: 200 },
        physicalAddress: { type: 'string', minLength: 3, maxLength: 200 },
        telephone: { type: 'string', pattern: '^\\+[1-9][0-9]{6,14}$' },
        email: { type: 'string', format: 'email' },
        occupation: { type: 'string', minLength: 2, maxLength: 100 },
      },
    },
    partII: {
      type: 'object',
      description: 'Information on the person whose declaration is sought to be accessed',
      required: ['name', 'entity', 'workStation'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 200 },
        entity: {
          type: 'string',
          minLength: 2,
          maxLength: 200,
          description: 'Entity of the public officer',
        },
        workStation: { type: 'string', maxLength: 200 },
        personnelFileNumber: { type: 'string', maxLength: 30, description: 'Optional, if known' },
      },
    },
    partIII: {
      type: 'object',
      description: 'Information sought',
      required: ['informationSought', 'reason', 'otherInformation'],
      additionalProperties: false,
      properties: {
        informationSought: { type: 'string', minLength: 10, maxLength: 4000 },
        reason: {
          type: 'string',
          minLength: 10,
          maxLength: 4000,
          description:
            'Reason for requiring the information (legitimate interest and good cause, Act s.36(1))',
        },
        otherInformation: { type: 'string', maxLength: 4000 },
      },
    },
    partIV: {
      type: 'object',
      description: 'Declaration',
      required: ['text', 'declaredAt'],
      additionalProperties: false,
      properties: {
        text: {
          const:
            'I declare that the information I have given above is true, complete and correct to the best of my knowledge.',
        },
        declaredAt: { type: 'string', format: 'date-time' },
      },
    },
    scope: {
      type: 'object',
      description: 'Platform scope fields (Admin Mechanism 31 scoped access)',
      required: ['years', 'includeSpouses', 'includeChildren', 'sections', 'includeClarifications'],
      additionalProperties: false,
      properties: {
        years: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          uniqueItems: true,
          items: { type: 'integer', minimum: 2025 },
        },
        includeSpouses: { type: 'boolean' },
        includeChildren: { type: 'boolean' },
        sections: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string', enum: ['bio', 'income', 'assets', 'liabilities', 'other'] },
        },
        includeClarifications: { type: 'boolean' },
      },
    },
    meta: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reference: { type: 'string' },
        submittedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
};
const pattern4 = new RegExp('^[a-z][a-z0-9]{1,19}$', 'u');
const pattern5 = new RegExp('^[A-Z]{2}$', 'u');
const pattern6 = new RegExp('^\\+[1-9][0-9]{6,14}$', 'u');
const func1 = ucs2length;
const formats0 =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const formats2 = fullFormats['date-time'];
function validate20(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  /*# sourceURL="https://adili.go.ke/schemas/form-k.v1.json" */ let vErrors = null;
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
    if (data.responsibleCommission === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'responsibleCommission' },
        message: "must have required property '" + 'responsibleCommission' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.partI === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'partI' },
        message: "must have required property '" + 'partI' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.partII === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'partII' },
        message: "must have required property '" + 'partII' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.partIII === undefined) {
      const err4 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'partIII' },
        message: "must have required property '" + 'partIII' + "'",
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.partIV === undefined) {
      const err5 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'partIV' },
        message: "must have required property '" + 'partIV' + "'",
      };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.scope === undefined) {
      const err6 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'scope' },
        message: "must have required property '" + 'scope' + "'",
      };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(
        key0 === 'schemaVersion' ||
        key0 === 'responsibleCommission' ||
        key0 === 'partI' ||
        key0 === 'partII' ||
        key0 === 'partIII' ||
        key0 === 'partIV' ||
        key0 === 'scope' ||
        key0 === 'meta'
      )) {
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
    if (data.schemaVersion !== undefined) {
      if ('form-k.v1' !== data.schemaVersion) {
        const err8 = {
          instancePath: instancePath + '/schemaVersion',
          schemaPath: '#/properties/schemaVersion/const',
          keyword: 'const',
          params: { allowedValue: 'form-k.v1' },
          message: 'must be equal to constant',
        };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.responsibleCommission !== undefined) {
      let data1 = data.responsibleCommission;
      if (typeof data1 === 'string') {
        if (!pattern4.test(data1)) {
          const err9 = {
            instancePath: instancePath + '/responsibleCommission',
            schemaPath: '#/properties/responsibleCommission/pattern',
            keyword: 'pattern',
            params: { pattern: '^[a-z][a-z0-9]{1,19}$' },
            message: 'must match pattern "' + '^[a-z][a-z0-9]{1,19}$' + '"',
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
          instancePath: instancePath + '/responsibleCommission',
          schemaPath: '#/properties/responsibleCommission/type',
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
    if (data.partI !== undefined) {
      let data2 = data.partI;
      if (data2 && typeof data2 == 'object' && !Array.isArray(data2)) {
        if (data2.name === undefined) {
          const err11 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
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
        if (data2.identityDocument === undefined) {
          const err12 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'identityDocument' },
            message: "must have required property '" + 'identityDocument' + "'",
          };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (data2.postalAddress === undefined) {
          const err13 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'postalAddress' },
            message: "must have required property '" + 'postalAddress' + "'",
          };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (data2.physicalAddress === undefined) {
          const err14 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'physicalAddress' },
            message: "must have required property '" + 'physicalAddress' + "'",
          };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (data2.telephone === undefined) {
          const err15 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'telephone' },
            message: "must have required property '" + 'telephone' + "'",
          };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (data2.email === undefined) {
          const err16 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'email' },
            message: "must have required property '" + 'email' + "'",
          };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
        if (data2.occupation === undefined) {
          const err17 = {
            instancePath: instancePath + '/partI',
            schemaPath: '#/properties/partI/required',
            keyword: 'required',
            params: { missingProperty: 'occupation' },
            message: "must have required property '" + 'occupation' + "'",
          };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
        for (const key1 in data2) {
          if (!(
            key1 === 'name' ||
            key1 === 'identityDocument' ||
            key1 === 'postalAddress' ||
            key1 === 'physicalAddress' ||
            key1 === 'telephone' ||
            key1 === 'email' ||
            key1 === 'occupation'
          )) {
            const err18 = {
              instancePath: instancePath + '/partI',
              schemaPath: '#/properties/partI/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err18];
            } else {
              vErrors.push(err18);
            }
            errors++;
          }
        }
        if (data2.name !== undefined) {
          let data3 = data2.name;
          if (typeof data3 === 'string') {
            if (func1(data3) > 200) {
              const err19 = {
                instancePath: instancePath + '/partI/name',
                schemaPath: '#/properties/partI/properties/name/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
            if (func1(data3) < 2) {
              const err20 = {
                instancePath: instancePath + '/partI/name',
                schemaPath: '#/properties/partI/properties/name/minLength',
                keyword: 'minLength',
                params: { limit: 2 },
                message: 'must NOT have fewer than 2 characters',
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
              instancePath: instancePath + '/partI/name',
              schemaPath: '#/properties/partI/properties/name/type',
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
        if (data2.identityDocument !== undefined) {
          let data4 = data2.identityDocument;
          if (data4 && typeof data4 == 'object' && !Array.isArray(data4)) {
            if (data4.kind === undefined) {
              const err22 = {
                instancePath: instancePath + '/partI/identityDocument',
                schemaPath: '#/properties/partI/properties/identityDocument/required',
                keyword: 'required',
                params: { missingProperty: 'kind' },
                message: "must have required property '" + 'kind' + "'",
              };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
            if (data4.number === undefined) {
              const err23 = {
                instancePath: instancePath + '/partI/identityDocument',
                schemaPath: '#/properties/partI/properties/identityDocument/required',
                keyword: 'required',
                params: { missingProperty: 'number' },
                message: "must have required property '" + 'number' + "'",
              };
              if (vErrors === null) {
                vErrors = [err23];
              } else {
                vErrors.push(err23);
              }
              errors++;
            }
            for (const key2 in data4) {
              if (!(key2 === 'kind' || key2 === 'number' || key2 === 'country')) {
                const err24 = {
                  instancePath: instancePath + '/partI/identityDocument',
                  schemaPath: '#/properties/partI/properties/identityDocument/additionalProperties',
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
            if (data4.kind !== undefined) {
              let data5 = data4.kind;
              if (typeof data5 !== 'string') {
                const err25 = {
                  instancePath: instancePath + '/partI/identityDocument/kind',
                  schemaPath: '#/properties/partI/properties/identityDocument/properties/kind/type',
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
              if (!(data5 === 'national-id' || data5 === 'passport')) {
                const err26 = {
                  instancePath: instancePath + '/partI/identityDocument/kind',
                  schemaPath: '#/properties/partI/properties/identityDocument/properties/kind/enum',
                  keyword: 'enum',
                  params: {
                    allowedValues:
                      schema31.properties.partI.properties.identityDocument.properties.kind.enum,
                  },
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
            if (data4.number !== undefined) {
              let data6 = data4.number;
              if (typeof data6 === 'string') {
                if (func1(data6) > 20) {
                  const err27 = {
                    instancePath: instancePath + '/partI/identityDocument/number',
                    schemaPath:
                      '#/properties/partI/properties/identityDocument/properties/number/maxLength',
                    keyword: 'maxLength',
                    params: { limit: 20 },
                    message: 'must NOT have more than 20 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err27];
                  } else {
                    vErrors.push(err27);
                  }
                  errors++;
                }
                if (func1(data6) < 5) {
                  const err28 = {
                    instancePath: instancePath + '/partI/identityDocument/number',
                    schemaPath:
                      '#/properties/partI/properties/identityDocument/properties/number/minLength',
                    keyword: 'minLength',
                    params: { limit: 5 },
                    message: 'must NOT have fewer than 5 characters',
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
                  instancePath: instancePath + '/partI/identityDocument/number',
                  schemaPath:
                    '#/properties/partI/properties/identityDocument/properties/number/type',
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
            if (data4.country !== undefined) {
              let data7 = data4.country;
              if (typeof data7 === 'string') {
                if (!pattern5.test(data7)) {
                  const err30 = {
                    instancePath: instancePath + '/partI/identityDocument/country',
                    schemaPath:
                      '#/properties/partI/properties/identityDocument/properties/country/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^[A-Z]{2}$' },
                    message: 'must match pattern "' + '^[A-Z]{2}$' + '"',
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
                  instancePath: instancePath + '/partI/identityDocument/country',
                  schemaPath:
                    '#/properties/partI/properties/identityDocument/properties/country/type',
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
          } else {
            const err32 = {
              instancePath: instancePath + '/partI/identityDocument',
              schemaPath: '#/properties/partI/properties/identityDocument/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
        if (data2.postalAddress !== undefined) {
          let data8 = data2.postalAddress;
          if (typeof data8 === 'string') {
            if (func1(data8) > 200) {
              const err33 = {
                instancePath: instancePath + '/partI/postalAddress',
                schemaPath: '#/properties/partI/properties/postalAddress/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
            }
            if (func1(data8) < 3) {
              const err34 = {
                instancePath: instancePath + '/partI/postalAddress',
                schemaPath: '#/properties/partI/properties/postalAddress/minLength',
                keyword: 'minLength',
                params: { limit: 3 },
                message: 'must NOT have fewer than 3 characters',
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
              instancePath: instancePath + '/partI/postalAddress',
              schemaPath: '#/properties/partI/properties/postalAddress/type',
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
        if (data2.physicalAddress !== undefined) {
          let data9 = data2.physicalAddress;
          if (typeof data9 === 'string') {
            if (func1(data9) > 200) {
              const err36 = {
                instancePath: instancePath + '/partI/physicalAddress',
                schemaPath: '#/properties/partI/properties/physicalAddress/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err36];
              } else {
                vErrors.push(err36);
              }
              errors++;
            }
            if (func1(data9) < 3) {
              const err37 = {
                instancePath: instancePath + '/partI/physicalAddress',
                schemaPath: '#/properties/partI/properties/physicalAddress/minLength',
                keyword: 'minLength',
                params: { limit: 3 },
                message: 'must NOT have fewer than 3 characters',
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
              instancePath: instancePath + '/partI/physicalAddress',
              schemaPath: '#/properties/partI/properties/physicalAddress/type',
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
        if (data2.telephone !== undefined) {
          let data10 = data2.telephone;
          if (typeof data10 === 'string') {
            if (!pattern6.test(data10)) {
              const err39 = {
                instancePath: instancePath + '/partI/telephone',
                schemaPath: '#/properties/partI/properties/telephone/pattern',
                keyword: 'pattern',
                params: { pattern: '^\\+[1-9][0-9]{6,14}$' },
                message: 'must match pattern "' + '^\\+[1-9][0-9]{6,14}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err39];
              } else {
                vErrors.push(err39);
              }
              errors++;
            }
          } else {
            const err40 = {
              instancePath: instancePath + '/partI/telephone',
              schemaPath: '#/properties/partI/properties/telephone/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err40];
            } else {
              vErrors.push(err40);
            }
            errors++;
          }
        }
        if (data2.email !== undefined) {
          let data11 = data2.email;
          if (typeof data11 === 'string') {
            if (!formats0.test(data11)) {
              const err41 = {
                instancePath: instancePath + '/partI/email',
                schemaPath: '#/properties/partI/properties/email/format',
                keyword: 'format',
                params: { format: 'email' },
                message: 'must match format "' + 'email' + '"',
              };
              if (vErrors === null) {
                vErrors = [err41];
              } else {
                vErrors.push(err41);
              }
              errors++;
            }
          } else {
            const err42 = {
              instancePath: instancePath + '/partI/email',
              schemaPath: '#/properties/partI/properties/email/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
        }
        if (data2.occupation !== undefined) {
          let data12 = data2.occupation;
          if (typeof data12 === 'string') {
            if (func1(data12) > 100) {
              const err43 = {
                instancePath: instancePath + '/partI/occupation',
                schemaPath: '#/properties/partI/properties/occupation/maxLength',
                keyword: 'maxLength',
                params: { limit: 100 },
                message: 'must NOT have more than 100 characters',
              };
              if (vErrors === null) {
                vErrors = [err43];
              } else {
                vErrors.push(err43);
              }
              errors++;
            }
            if (func1(data12) < 2) {
              const err44 = {
                instancePath: instancePath + '/partI/occupation',
                schemaPath: '#/properties/partI/properties/occupation/minLength',
                keyword: 'minLength',
                params: { limit: 2 },
                message: 'must NOT have fewer than 2 characters',
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
              instancePath: instancePath + '/partI/occupation',
              schemaPath: '#/properties/partI/properties/occupation/type',
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
          instancePath: instancePath + '/partI',
          schemaPath: '#/properties/partI/type',
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
    if (data.partII !== undefined) {
      let data13 = data.partII;
      if (data13 && typeof data13 == 'object' && !Array.isArray(data13)) {
        if (data13.name === undefined) {
          const err47 = {
            instancePath: instancePath + '/partII',
            schemaPath: '#/properties/partII/required',
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
        if (data13.entity === undefined) {
          const err48 = {
            instancePath: instancePath + '/partII',
            schemaPath: '#/properties/partII/required',
            keyword: 'required',
            params: { missingProperty: 'entity' },
            message: "must have required property '" + 'entity' + "'",
          };
          if (vErrors === null) {
            vErrors = [err48];
          } else {
            vErrors.push(err48);
          }
          errors++;
        }
        if (data13.workStation === undefined) {
          const err49 = {
            instancePath: instancePath + '/partII',
            schemaPath: '#/properties/partII/required',
            keyword: 'required',
            params: { missingProperty: 'workStation' },
            message: "must have required property '" + 'workStation' + "'",
          };
          if (vErrors === null) {
            vErrors = [err49];
          } else {
            vErrors.push(err49);
          }
          errors++;
        }
        for (const key3 in data13) {
          if (!(
            key3 === 'name' ||
            key3 === 'entity' ||
            key3 === 'workStation' ||
            key3 === 'personnelFileNumber'
          )) {
            const err50 = {
              instancePath: instancePath + '/partII',
              schemaPath: '#/properties/partII/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key3 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err50];
            } else {
              vErrors.push(err50);
            }
            errors++;
          }
        }
        if (data13.name !== undefined) {
          let data14 = data13.name;
          if (typeof data14 === 'string') {
            if (func1(data14) > 200) {
              const err51 = {
                instancePath: instancePath + '/partII/name',
                schemaPath: '#/properties/partII/properties/name/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err51];
              } else {
                vErrors.push(err51);
              }
              errors++;
            }
            if (func1(data14) < 2) {
              const err52 = {
                instancePath: instancePath + '/partII/name',
                schemaPath: '#/properties/partII/properties/name/minLength',
                keyword: 'minLength',
                params: { limit: 2 },
                message: 'must NOT have fewer than 2 characters',
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
              instancePath: instancePath + '/partII/name',
              schemaPath: '#/properties/partII/properties/name/type',
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
        if (data13.entity !== undefined) {
          let data15 = data13.entity;
          if (typeof data15 === 'string') {
            if (func1(data15) > 200) {
              const err54 = {
                instancePath: instancePath + '/partII/entity',
                schemaPath: '#/properties/partII/properties/entity/maxLength',
                keyword: 'maxLength',
                params: { limit: 200 },
                message: 'must NOT have more than 200 characters',
              };
              if (vErrors === null) {
                vErrors = [err54];
              } else {
                vErrors.push(err54);
              }
              errors++;
            }
            if (func1(data15) < 2) {
              const err55 = {
                instancePath: instancePath + '/partII/entity',
                schemaPath: '#/properties/partII/properties/entity/minLength',
                keyword: 'minLength',
                params: { limit: 2 },
                message: 'must NOT have fewer than 2 characters',
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
              instancePath: instancePath + '/partII/entity',
              schemaPath: '#/properties/partII/properties/entity/type',
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
        if (data13.workStation !== undefined) {
          let data16 = data13.workStation;
          if (typeof data16 === 'string') {
            if (func1(data16) > 200) {
              const err57 = {
                instancePath: instancePath + '/partII/workStation',
                schemaPath: '#/properties/partII/properties/workStation/maxLength',
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
              instancePath: instancePath + '/partII/workStation',
              schemaPath: '#/properties/partII/properties/workStation/type',
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
        if (data13.personnelFileNumber !== undefined) {
          let data17 = data13.personnelFileNumber;
          if (typeof data17 === 'string') {
            if (func1(data17) > 30) {
              const err59 = {
                instancePath: instancePath + '/partII/personnelFileNumber',
                schemaPath: '#/properties/partII/properties/personnelFileNumber/maxLength',
                keyword: 'maxLength',
                params: { limit: 30 },
                message: 'must NOT have more than 30 characters',
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
              instancePath: instancePath + '/partII/personnelFileNumber',
              schemaPath: '#/properties/partII/properties/personnelFileNumber/type',
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
          instancePath: instancePath + '/partII',
          schemaPath: '#/properties/partII/type',
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
    if (data.partIII !== undefined) {
      let data18 = data.partIII;
      if (data18 && typeof data18 == 'object' && !Array.isArray(data18)) {
        if (data18.informationSought === undefined) {
          const err62 = {
            instancePath: instancePath + '/partIII',
            schemaPath: '#/properties/partIII/required',
            keyword: 'required',
            params: { missingProperty: 'informationSought' },
            message: "must have required property '" + 'informationSought' + "'",
          };
          if (vErrors === null) {
            vErrors = [err62];
          } else {
            vErrors.push(err62);
          }
          errors++;
        }
        if (data18.reason === undefined) {
          const err63 = {
            instancePath: instancePath + '/partIII',
            schemaPath: '#/properties/partIII/required',
            keyword: 'required',
            params: { missingProperty: 'reason' },
            message: "must have required property '" + 'reason' + "'",
          };
          if (vErrors === null) {
            vErrors = [err63];
          } else {
            vErrors.push(err63);
          }
          errors++;
        }
        if (data18.otherInformation === undefined) {
          const err64 = {
            instancePath: instancePath + '/partIII',
            schemaPath: '#/properties/partIII/required',
            keyword: 'required',
            params: { missingProperty: 'otherInformation' },
            message: "must have required property '" + 'otherInformation' + "'",
          };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
        for (const key4 in data18) {
          if (!(key4 === 'informationSought' || key4 === 'reason' || key4 === 'otherInformation')) {
            const err65 = {
              instancePath: instancePath + '/partIII',
              schemaPath: '#/properties/partIII/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key4 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err65];
            } else {
              vErrors.push(err65);
            }
            errors++;
          }
        }
        if (data18.informationSought !== undefined) {
          let data19 = data18.informationSought;
          if (typeof data19 === 'string') {
            if (func1(data19) > 4000) {
              const err66 = {
                instancePath: instancePath + '/partIII/informationSought',
                schemaPath: '#/properties/partIII/properties/informationSought/maxLength',
                keyword: 'maxLength',
                params: { limit: 4000 },
                message: 'must NOT have more than 4000 characters',
              };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
            if (func1(data19) < 10) {
              const err67 = {
                instancePath: instancePath + '/partIII/informationSought',
                schemaPath: '#/properties/partIII/properties/informationSought/minLength',
                keyword: 'minLength',
                params: { limit: 10 },
                message: 'must NOT have fewer than 10 characters',
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
              instancePath: instancePath + '/partIII/informationSought',
              schemaPath: '#/properties/partIII/properties/informationSought/type',
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
        if (data18.reason !== undefined) {
          let data20 = data18.reason;
          if (typeof data20 === 'string') {
            if (func1(data20) > 4000) {
              const err69 = {
                instancePath: instancePath + '/partIII/reason',
                schemaPath: '#/properties/partIII/properties/reason/maxLength',
                keyword: 'maxLength',
                params: { limit: 4000 },
                message: 'must NOT have more than 4000 characters',
              };
              if (vErrors === null) {
                vErrors = [err69];
              } else {
                vErrors.push(err69);
              }
              errors++;
            }
            if (func1(data20) < 10) {
              const err70 = {
                instancePath: instancePath + '/partIII/reason',
                schemaPath: '#/properties/partIII/properties/reason/minLength',
                keyword: 'minLength',
                params: { limit: 10 },
                message: 'must NOT have fewer than 10 characters',
              };
              if (vErrors === null) {
                vErrors = [err70];
              } else {
                vErrors.push(err70);
              }
              errors++;
            }
          } else {
            const err71 = {
              instancePath: instancePath + '/partIII/reason',
              schemaPath: '#/properties/partIII/properties/reason/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err71];
            } else {
              vErrors.push(err71);
            }
            errors++;
          }
        }
        if (data18.otherInformation !== undefined) {
          let data21 = data18.otherInformation;
          if (typeof data21 === 'string') {
            if (func1(data21) > 4000) {
              const err72 = {
                instancePath: instancePath + '/partIII/otherInformation',
                schemaPath: '#/properties/partIII/properties/otherInformation/maxLength',
                keyword: 'maxLength',
                params: { limit: 4000 },
                message: 'must NOT have more than 4000 characters',
              };
              if (vErrors === null) {
                vErrors = [err72];
              } else {
                vErrors.push(err72);
              }
              errors++;
            }
          } else {
            const err73 = {
              instancePath: instancePath + '/partIII/otherInformation',
              schemaPath: '#/properties/partIII/properties/otherInformation/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
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
          instancePath: instancePath + '/partIII',
          schemaPath: '#/properties/partIII/type',
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
    }
    if (data.partIV !== undefined) {
      let data22 = data.partIV;
      if (data22 && typeof data22 == 'object' && !Array.isArray(data22)) {
        if (data22.text === undefined) {
          const err75 = {
            instancePath: instancePath + '/partIV',
            schemaPath: '#/properties/partIV/required',
            keyword: 'required',
            params: { missingProperty: 'text' },
            message: "must have required property '" + 'text' + "'",
          };
          if (vErrors === null) {
            vErrors = [err75];
          } else {
            vErrors.push(err75);
          }
          errors++;
        }
        if (data22.declaredAt === undefined) {
          const err76 = {
            instancePath: instancePath + '/partIV',
            schemaPath: '#/properties/partIV/required',
            keyword: 'required',
            params: { missingProperty: 'declaredAt' },
            message: "must have required property '" + 'declaredAt' + "'",
          };
          if (vErrors === null) {
            vErrors = [err76];
          } else {
            vErrors.push(err76);
          }
          errors++;
        }
        for (const key5 in data22) {
          if (!(key5 === 'text' || key5 === 'declaredAt')) {
            const err77 = {
              instancePath: instancePath + '/partIV',
              schemaPath: '#/properties/partIV/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key5 },
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
        if (data22.text !== undefined) {
          if (
            'I declare that the information I have given above is true, complete and correct to the best of my knowledge.' !==
            data22.text
          ) {
            const err78 = {
              instancePath: instancePath + '/partIV/text',
              schemaPath: '#/properties/partIV/properties/text/const',
              keyword: 'const',
              params: {
                allowedValue:
                  'I declare that the information I have given above is true, complete and correct to the best of my knowledge.',
              },
              message: 'must be equal to constant',
            };
            if (vErrors === null) {
              vErrors = [err78];
            } else {
              vErrors.push(err78);
            }
            errors++;
          }
        }
        if (data22.declaredAt !== undefined) {
          let data24 = data22.declaredAt;
          if (typeof data24 === 'string') {
            if (!formats2.validate(data24)) {
              const err79 = {
                instancePath: instancePath + '/partIV/declaredAt',
                schemaPath: '#/properties/partIV/properties/declaredAt/format',
                keyword: 'format',
                params: { format: 'date-time' },
                message: 'must match format "' + 'date-time' + '"',
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
              instancePath: instancePath + '/partIV/declaredAt',
              schemaPath: '#/properties/partIV/properties/declaredAt/type',
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
      } else {
        const err81 = {
          instancePath: instancePath + '/partIV',
          schemaPath: '#/properties/partIV/type',
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
    }
    if (data.scope !== undefined) {
      let data25 = data.scope;
      if (data25 && typeof data25 == 'object' && !Array.isArray(data25)) {
        if (data25.years === undefined) {
          const err82 = {
            instancePath: instancePath + '/scope',
            schemaPath: '#/properties/scope/required',
            keyword: 'required',
            params: { missingProperty: 'years' },
            message: "must have required property '" + 'years' + "'",
          };
          if (vErrors === null) {
            vErrors = [err82];
          } else {
            vErrors.push(err82);
          }
          errors++;
        }
        if (data25.includeSpouses === undefined) {
          const err83 = {
            instancePath: instancePath + '/scope',
            schemaPath: '#/properties/scope/required',
            keyword: 'required',
            params: { missingProperty: 'includeSpouses' },
            message: "must have required property '" + 'includeSpouses' + "'",
          };
          if (vErrors === null) {
            vErrors = [err83];
          } else {
            vErrors.push(err83);
          }
          errors++;
        }
        if (data25.includeChildren === undefined) {
          const err84 = {
            instancePath: instancePath + '/scope',
            schemaPath: '#/properties/scope/required',
            keyword: 'required',
            params: { missingProperty: 'includeChildren' },
            message: "must have required property '" + 'includeChildren' + "'",
          };
          if (vErrors === null) {
            vErrors = [err84];
          } else {
            vErrors.push(err84);
          }
          errors++;
        }
        if (data25.sections === undefined) {
          const err85 = {
            instancePath: instancePath + '/scope',
            schemaPath: '#/properties/scope/required',
            keyword: 'required',
            params: { missingProperty: 'sections' },
            message: "must have required property '" + 'sections' + "'",
          };
          if (vErrors === null) {
            vErrors = [err85];
          } else {
            vErrors.push(err85);
          }
          errors++;
        }
        if (data25.includeClarifications === undefined) {
          const err86 = {
            instancePath: instancePath + '/scope',
            schemaPath: '#/properties/scope/required',
            keyword: 'required',
            params: { missingProperty: 'includeClarifications' },
            message: "must have required property '" + 'includeClarifications' + "'",
          };
          if (vErrors === null) {
            vErrors = [err86];
          } else {
            vErrors.push(err86);
          }
          errors++;
        }
        for (const key6 in data25) {
          if (!(
            key6 === 'years' ||
            key6 === 'includeSpouses' ||
            key6 === 'includeChildren' ||
            key6 === 'sections' ||
            key6 === 'includeClarifications'
          )) {
            const err87 = {
              instancePath: instancePath + '/scope',
              schemaPath: '#/properties/scope/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key6 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err87];
            } else {
              vErrors.push(err87);
            }
            errors++;
          }
        }
        if (data25.years !== undefined) {
          let data26 = data25.years;
          if (Array.isArray(data26)) {
            if (data26.length > 50) {
              const err88 = {
                instancePath: instancePath + '/scope/years',
                schemaPath: '#/properties/scope/properties/years/maxItems',
                keyword: 'maxItems',
                params: { limit: 50 },
                message: 'must NOT have more than 50 items',
              };
              if (vErrors === null) {
                vErrors = [err88];
              } else {
                vErrors.push(err88);
              }
              errors++;
            }
            if (data26.length < 1) {
              const err89 = {
                instancePath: instancePath + '/scope/years',
                schemaPath: '#/properties/scope/properties/years/minItems',
                keyword: 'minItems',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 items',
              };
              if (vErrors === null) {
                vErrors = [err89];
              } else {
                vErrors.push(err89);
              }
              errors++;
            }
            const len0 = data26.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data27 = data26[i0];
              if (!(
                typeof data27 == 'number' &&
                !(data27 % 1) &&
                !isNaN(data27) &&
                isFinite(data27)
              )) {
                const err90 = {
                  instancePath: instancePath + '/scope/years/' + i0,
                  schemaPath: '#/properties/scope/properties/years/items/type',
                  keyword: 'type',
                  params: { type: 'integer' },
                  message: 'must be integer',
                };
                if (vErrors === null) {
                  vErrors = [err90];
                } else {
                  vErrors.push(err90);
                }
                errors++;
              }
              if (typeof data27 == 'number' && isFinite(data27)) {
                if (data27 < 2025 || isNaN(data27)) {
                  const err91 = {
                    instancePath: instancePath + '/scope/years/' + i0,
                    schemaPath: '#/properties/scope/properties/years/items/minimum',
                    keyword: 'minimum',
                    params: { comparison: '>=', limit: 2025 },
                    message: 'must be >= 2025',
                  };
                  if (vErrors === null) {
                    vErrors = [err91];
                  } else {
                    vErrors.push(err91);
                  }
                  errors++;
                }
              }
            }
            let i1 = data26.length;
            let j0;
            if (i1 > 1) {
              const indices0 = {};
              for (; i1--;) {
                let item0 = data26[i1];
                if (!(
                  typeof item0 == 'number' &&
                  !(item0 % 1) &&
                  !isNaN(item0) &&
                  isFinite(item0)
                )) {
                  continue;
                }
                if (typeof indices0[item0] == 'number') {
                  j0 = indices0[item0];
                  const err92 = {
                    instancePath: instancePath + '/scope/years',
                    schemaPath: '#/properties/scope/properties/years/uniqueItems',
                    keyword: 'uniqueItems',
                    params: { i: i1, j: j0 },
                    message:
                      'must NOT have duplicate items (items ## ' +
                      j0 +
                      ' and ' +
                      i1 +
                      ' are identical)',
                  };
                  if (vErrors === null) {
                    vErrors = [err92];
                  } else {
                    vErrors.push(err92);
                  }
                  errors++;
                  break;
                }
                indices0[item0] = i1;
              }
            }
          } else {
            const err93 = {
              instancePath: instancePath + '/scope/years',
              schemaPath: '#/properties/scope/properties/years/type',
              keyword: 'type',
              params: { type: 'array' },
              message: 'must be array',
            };
            if (vErrors === null) {
              vErrors = [err93];
            } else {
              vErrors.push(err93);
            }
            errors++;
          }
        }
        if (data25.includeSpouses !== undefined) {
          if (typeof data25.includeSpouses !== 'boolean') {
            const err94 = {
              instancePath: instancePath + '/scope/includeSpouses',
              schemaPath: '#/properties/scope/properties/includeSpouses/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err94];
            } else {
              vErrors.push(err94);
            }
            errors++;
          }
        }
        if (data25.includeChildren !== undefined) {
          if (typeof data25.includeChildren !== 'boolean') {
            const err95 = {
              instancePath: instancePath + '/scope/includeChildren',
              schemaPath: '#/properties/scope/properties/includeChildren/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err95];
            } else {
              vErrors.push(err95);
            }
            errors++;
          }
        }
        if (data25.sections !== undefined) {
          let data30 = data25.sections;
          if (Array.isArray(data30)) {
            if (data30.length < 1) {
              const err96 = {
                instancePath: instancePath + '/scope/sections',
                schemaPath: '#/properties/scope/properties/sections/minItems',
                keyword: 'minItems',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 items',
              };
              if (vErrors === null) {
                vErrors = [err96];
              } else {
                vErrors.push(err96);
              }
              errors++;
            }
            const len1 = data30.length;
            for (let i2 = 0; i2 < len1; i2++) {
              let data31 = data30[i2];
              if (typeof data31 !== 'string') {
                const err97 = {
                  instancePath: instancePath + '/scope/sections/' + i2,
                  schemaPath: '#/properties/scope/properties/sections/items/type',
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
              if (!(
                data31 === 'bio' ||
                data31 === 'income' ||
                data31 === 'assets' ||
                data31 === 'liabilities' ||
                data31 === 'other'
              )) {
                const err98 = {
                  instancePath: instancePath + '/scope/sections/' + i2,
                  schemaPath: '#/properties/scope/properties/sections/items/enum',
                  keyword: 'enum',
                  params: {
                    allowedValues: schema31.properties.scope.properties.sections.items.enum,
                  },
                  message: 'must be equal to one of the allowed values',
                };
                if (vErrors === null) {
                  vErrors = [err98];
                } else {
                  vErrors.push(err98);
                }
                errors++;
              }
            }
            let i3 = data30.length;
            let j1;
            if (i3 > 1) {
              const indices1 = {};
              for (; i3--;) {
                let item1 = data30[i3];
                if (typeof item1 !== 'string') {
                  continue;
                }
                if (typeof indices1[item1] == 'number') {
                  j1 = indices1[item1];
                  const err99 = {
                    instancePath: instancePath + '/scope/sections',
                    schemaPath: '#/properties/scope/properties/sections/uniqueItems',
                    keyword: 'uniqueItems',
                    params: { i: i3, j: j1 },
                    message:
                      'must NOT have duplicate items (items ## ' +
                      j1 +
                      ' and ' +
                      i3 +
                      ' are identical)',
                  };
                  if (vErrors === null) {
                    vErrors = [err99];
                  } else {
                    vErrors.push(err99);
                  }
                  errors++;
                  break;
                }
                indices1[item1] = i3;
              }
            }
          } else {
            const err100 = {
              instancePath: instancePath + '/scope/sections',
              schemaPath: '#/properties/scope/properties/sections/type',
              keyword: 'type',
              params: { type: 'array' },
              message: 'must be array',
            };
            if (vErrors === null) {
              vErrors = [err100];
            } else {
              vErrors.push(err100);
            }
            errors++;
          }
        }
        if (data25.includeClarifications !== undefined) {
          if (typeof data25.includeClarifications !== 'boolean') {
            const err101 = {
              instancePath: instancePath + '/scope/includeClarifications',
              schemaPath: '#/properties/scope/properties/includeClarifications/type',
              keyword: 'type',
              params: { type: 'boolean' },
              message: 'must be boolean',
            };
            if (vErrors === null) {
              vErrors = [err101];
            } else {
              vErrors.push(err101);
            }
            errors++;
          }
        }
      } else {
        const err102 = {
          instancePath: instancePath + '/scope',
          schemaPath: '#/properties/scope/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err102];
        } else {
          vErrors.push(err102);
        }
        errors++;
      }
    }
    if (data.meta !== undefined) {
      let data33 = data.meta;
      if (data33 && typeof data33 == 'object' && !Array.isArray(data33)) {
        for (const key7 in data33) {
          if (!(key7 === 'reference' || key7 === 'submittedAt')) {
            const err103 = {
              instancePath: instancePath + '/meta',
              schemaPath: '#/properties/meta/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key7 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err103];
            } else {
              vErrors.push(err103);
            }
            errors++;
          }
        }
        if (data33.reference !== undefined) {
          if (typeof data33.reference !== 'string') {
            const err104 = {
              instancePath: instancePath + '/meta/reference',
              schemaPath: '#/properties/meta/properties/reference/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err104];
            } else {
              vErrors.push(err104);
            }
            errors++;
          }
        }
        if (data33.submittedAt !== undefined) {
          let data35 = data33.submittedAt;
          if (typeof data35 === 'string') {
            if (!formats2.validate(data35)) {
              const err105 = {
                instancePath: instancePath + '/meta/submittedAt',
                schemaPath: '#/properties/meta/properties/submittedAt/format',
                keyword: 'format',
                params: { format: 'date-time' },
                message: 'must match format "' + 'date-time' + '"',
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
              instancePath: instancePath + '/meta/submittedAt',
              schemaPath: '#/properties/meta/properties/submittedAt/type',
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
      } else {
        const err107 = {
          instancePath: instancePath + '/meta',
          schemaPath: '#/properties/meta/type',
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
  } else {
    const err108 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err108];
    } else {
      vErrors.push(err108);
    }
    errors++;
  }
  validate20.errors = vErrors;
  return errors === 0;
}
validate20.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
