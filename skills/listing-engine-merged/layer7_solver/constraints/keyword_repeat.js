// layer7_solver/constraints/keyword_repeat.js

function limitKeywordRepeat(text, maxRepeat = 2) {
  const words = text.split(/\s+/);
  const counter = {};
  const result = [];

  for (const w of words) {
    const key = w.toLowerCase();
    counter[key] = (counter[key] || 0) + 1;

    if (counter[key] <= maxRepeat) {
      result.push(w);
    }
  }

  return result.join(" ");
}