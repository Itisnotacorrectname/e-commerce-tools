/**
 * layer7_solver/constraints/platform_rules.js
 */
'use strict';
var PLATFORM_CONSTRAINTS = {
  amazon:  { max_length: 200, forbidden: [], keyword_repeat: 3 },
  walmart: { max_length: 75,  forbidden: ['best','cheap','guaranteed'], keyword_repeat: 2 },
  wayfair: { max_length: 120, forbidden: ['best','top'], keyword_repeat: 2 }
};
module.exports = { PLATFORM_CONSTRAINTS };