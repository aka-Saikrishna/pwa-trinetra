const fs = require('fs');
const path = require('path');

const load = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '../../artefacts', name)));

module.exports = {
  INSPECTION_SCHEMA: load('INSPECTION_SCHEMA.json'),
  ROOM_TAXONOMY: load('ROOM_TAXONOMY.json'),
  SCORING_RULES: load('SCORING_RULES.json')
};