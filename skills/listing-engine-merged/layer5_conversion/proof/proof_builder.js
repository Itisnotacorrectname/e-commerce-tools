/**
 * layer5_conversion/proof/proof_builder.js
 *
 * 来自源B layer5_conversion/proof/proof_builder.js
 */

'use strict';

function proofBuilder(attributes) {
  attributes = attributes || {};
  var proofs = [];

  if (attributes.material && attributes.material.value) {
    proofs.push({ type: 'material', text: 'Made with premium ' + attributes.material.value });
  }
  if (attributes.certification && attributes.certification.value) {
    proofs.push({ type: 'cert', text: attributes.certification.value + ' certified' });
  }
  if (attributes.size && attributes.size.value) {
    proofs.push({ type: 'usage', text: 'Designed for ' + attributes.size.value });
  }

  return proofs;
}

module.exports = { proofBuilder };