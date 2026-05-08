// layer5_conversion/messaging/messaging_engine.js

function combine(hook, proof) {
  if (!proof) return hook.text;
  return `${hook.text} — ${proof.text}`;
}

function messagingEngine({ hooks = [], proofs = [] }) {
  const messages = [];

  hooks.forEach((h, i) => {
    const proof = proofs[i % proofs.length];
    messages.push(combine(h, proof));
  });

  return messages.slice(0, 5);
}