function scoreClarity(text) {
  if (!text) return 0;

  let score = 1;

  if (text.length > 140) score -= 0.3;
  if (text.length < 40) score -= 0.2;

  if (/[,;]{2,}/.test(text)) score -= 0.2;

  return Math.max(score, 0);
}