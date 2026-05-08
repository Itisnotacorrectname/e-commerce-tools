// layer7_solver/utils/similarity.js

function similarity(a, b) {
  const aWords = new Set(a.toLowerCase().split(" "));
  const bWords = new Set(b.toLowerCase().split(" "));

  const overlap = [...aWords].filter(w => bWords.has(w));

  return overlap.length / Math.max(aWords.size, 1);
}