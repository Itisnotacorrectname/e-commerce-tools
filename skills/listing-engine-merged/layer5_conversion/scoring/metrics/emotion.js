function scoreEmotion(text) {
  if (!text) return 0;

  const strong = /(no more|wake up|finally|stop|never again)/i;
  const medium = /(better|improve|enhance)/i;

  if (strong.test(text)) return 1;
  if (medium.test(text)) return 0.7;

  return 0.4;
}