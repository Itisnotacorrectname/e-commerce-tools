/**
 * layer5_conversion/messaging/messaging_engine.js
 * Combines hooks + proofs into marketing messages
 */
'use strict';

function messagingEngine(input) {
  var hooks = (input && input.hooks) || [];
  var proofs = (input && input.proofs) || [];
  var messages = [];
  for (var i = 0; i < hooks.length; i++) {
    var hook = hooks[i];
    var proof = null;
    for (var j = 0; j < proofs.length; j++) {
      if (proofs[j].type === hook.targetIntent) { proof = proofs[j]; break; }
    }
    if (!proof && proofs.length > 0) proof = proofs[0];
    var text = proof ? (hook.text + ' ' + proof.text).trim() : hook.text;
    if (text) messages.push(text);
  }
  return messages.length > 0 ? messages : ['Quality construction for everyday use'];
}

module.exports = { messagingEngine };