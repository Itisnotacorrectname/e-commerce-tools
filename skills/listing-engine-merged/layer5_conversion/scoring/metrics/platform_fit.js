function scorePlatformFit(text, platform) {
  if (!text) return 0;

  switch (platform) {
    case "amazon":
      return scoreAmazon(text);
    case "walmart":
      return scoreWalmart(text);
    case "wayfair":
      return scoreWayfair(text);
    default:
      return 0.5;
  }
}

function scoreAmazon(text) {
  // SEO + 信息密度
  let score = 0.8;
  if (text.length > 80) score += 0.1;
  return Math.min(score, 1);
}

function scoreWalmart(text) {
  // 简洁优先
  if (text.length > 100) return 0.6;
  return 1;
}

function scoreWayfair(text) {
  // 参数 + 描述性
  if (/\d|inch|cm|material/i.test(text)) return 1;
  return 0.7;
}