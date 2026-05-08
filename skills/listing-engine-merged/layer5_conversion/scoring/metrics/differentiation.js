function scoreDifferentiation(text, competitors = []) {
  if (!text) return 0;

  let score = 1;

  competitors.forEach(c => {
    if (!c.title) return;

    const overlap = textSimilarity(text, c.title);

    if (overlap > 0.7) score -= 0.3;
  });

  return Math.max(score, 0.3);
}

// 简单相似度
function textSimilarity(a, b) {
  const aWords = new Set(a.toLowerCase().split(" "));
  const bWords = new Set(b.toLowerCase().split(" "));

  const intersection = [...aWords].filter(w => bWords.has(w));

  return intersection.length / Math.max(aWords.size, 1);
}