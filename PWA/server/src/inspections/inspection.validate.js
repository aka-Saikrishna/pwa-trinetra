const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true });
const schema = require('../../artefacts/INSPECTION_SCHEMA.json');

const validate = ajv.compile(schema);

exports.validateInspection = (json) => {
  if (!validate(json)) {
    const e = new Error('INSPECTION_SCHEMA_INVALID');
    e.details = validate.errors;
    throw e;
  }
};