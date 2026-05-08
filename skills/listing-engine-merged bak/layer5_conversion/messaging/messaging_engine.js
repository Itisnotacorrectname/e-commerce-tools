/**
 * layer5_conversion/messaging/messaging_engine.js
 *
 * 来自源B layer5_conversion/messaging/messaging_engine.js
 */

'use strict';

function combine(hook, proof) {
  if (!proof) return hook.text;
  return hook.text + ' — ' + proof.text;
}

function messagingEngine(hooks, proofs) {
  hooks = hooks || [];
  proofs = proofs || [];
  var messages = [];

  hooks.forEach(function(h, i) {
    var proof = proofs[i % proofs.length];
    messages.push(combine(h, proof));
  });

  return messages.slice(0, 5);
}

module.exports = { messagingEngine };