// layer5_conversion/intent/intent_extractor.js

const INTENT_RULES = [
  { match: /pain|back|orthopedic/i, intent: "pain_relief", weight: 0.9 },
  { match: /sleep|comfort|soft|firm/i, intent: "comfort", weight: 0.85 },
  { match: /small|space|compact/i, intent: "space_saving", weight: 0.8 },
  { match: /fast|powerful|performance/i, intent: "performance", weight: 0.8 },
  { match: /design|modern|luxury/i, intent: "aesthetic", weight: 0.7 },
  { match: /durable|long-lasting/i, intent: "durability", weight: 0.75 }
];

function intentExtractor(ctx) {
  const keyword = ctx.get("core.keyword") || "";
  const attrs = ctx.get("core.attributes") || {};

  const signals = [keyword, ...Object.values(attrs).map(v => v.value || "")].join(" ");

  const intents = INTENT_RULES
    .filter(rule => rule.match.test(signals))
    .map(rule => ({ type: rule.intent, weight: rule.weight }));

  return intents.length ? intents : [{ type: "generic", weight: 0.5 }];
}