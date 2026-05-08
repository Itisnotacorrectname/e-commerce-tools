// layer5_conversion/hook/hook_generator.js

function outcomeHook(pain) {
  return `Wake up without ${pain}`;
}

function removalHook(pain) {
  return `No more ${pain}`;
}

function scenarioHook(pain) {
  return `Perfect for anyone dealing with ${pain}`;
}

function hookGenerator(pains = []) {
  const hooks = [];

  pains.forEach(p => {
    hooks.push({
      text: outcomeHook(p.pain),
      type: "outcome",
      emotion: p.emotion
    });

    hooks.push({
      text: removalHook(p.pain),
      type: "removal",
      emotion: p.emotion
    });

    hooks.push({
      text: scenarioHook(p.pain),
      type: "scenario",
      emotion: p.emotion
    });
  });

  return hooks.slice(0, 10);
}