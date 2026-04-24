/**
 * kb_rules.js — E-GEO + p15 knowledge rules for bullet scoring
 * Embedded from 2511.20867v1.kb.txt and p15.kb.txt
 */

module.exports = {
  // E-GEO 10 features that make product descriptions rank higher in LLM comparisons
  // (from E-GEO paper Table 3)
  egeoFeatures: [
    {
      id: 'RANKING',
      label: 'Ranking Emphasis',
      desc: 'Emphasizes the goal of achieving a higher rank / positions product as best choice',
      weight: 1.5
    },
    {
      id: 'USER_INTENT',
      label: 'User Intent Alignment',
      desc: 'Anticipates and aligns with what shoppers want to know at each stage',
      weight: 2.0
    },
    {
      id: 'COMPETITIVENESS',
      label: 'Competitiveness',
      desc: 'Compares favorably against alternatives without naming competitors (unlike/versus)',
      weight: 1.0
    },
    {
      id: 'REVIEWS_RATINGS',
      label: 'Social Proof',
      desc: 'Draws on positive customer reviews, ratings, or testimonials as external evidence',
      weight: 1.5
    },
    {
      id: 'COMPELLING',
      label: 'Compelling Narrative',
      desc: 'Adopts persuasive, engaging narrative tone that holds attention',
      weight: 1.0
    },
    {
      id: 'AUTHORITATIVENESS',
      label: 'Authoritativeness',
      desc: 'Uses confident, assertive voice; specific facts over vague claims',
      weight: 1.5
    },
    {
      id: 'USP',
      label: 'Unique Selling Points',
      desc: 'Focuses on differentiated features that set this product apart',
      weight: 2.0
    },
    {
      id: 'URGENCY',
      label: 'Urgent Call-to-Action',
      desc: 'Includes sense of urgency, scarcity, or clear next step',
      weight: 0.5
    },
    {
      id: 'SCANNABLE',
      label: 'Easily Scannable',
      desc: 'Uses bullets, headings, numbers; scannable structure',
      weight: 1.0
    },
    {
      id: 'FACTUALITY',
      label: 'Maintains Factuality',
      desc: 'All claims are specific and verifiable; no vague superlatives',
      weight: 1.5
    }
  ],

  // p15 shopping journey stages + Q&A intents
  // (from Q&A Recommendation paper — Rufus system foundation)
  shoppingStages: [
    {
      stage: 'Exploration',
      label: '了解产品空间',
      desc: '用户在初步了解产品类型，学习基本知识',
      questions: ['这是什么产品？', '跟其他类型有什么区别？', '适合什么场景？']
    },
    {
      stage: 'Comparison',
      label: '比较产品',
      desc: '用户在比较几个候选产品的优劣势',
      questions: ['这个比那个好在哪里？', '各自的优缺点是什么？', '哪个性价比更高？']
    },
    {
      stage: 'Final Consideration',
      label: '最终决策',
      desc: '用户已缩小范围，关注具体细节',
      questions: ['具体尺寸是多少？', '保修期多久？', '有没有认证？', '噪音多大？']
    }
  ],

  qaIntents: [
    { intent: 'Aspect',        label: '产品具体属性',       desc: '尺寸、重量、容量、材质等具体参数' },
    { intent: 'Comparison',    label: '比较类问题',         desc: '与其他产品的比较' },
    { intent: 'GeneralKnowledge', label: '基础知识',       desc: '产品类型的基本知识' },
    { intent: 'Offer',         label: '购买相关',           desc: '价格、保修、退货政策、库存' },
    { intent: 'How-to',        label: '使用说明',           desc: '如何使用、清洁、维护' },
    { intent: 'Subjective',    label: '主观评价',           desc: '用户评论、体验分享' }
  ],

  // Core scoring logic: analyze a bullet string and return feature scores
  analyzeBullet: function(bulletText, title) {
    var bt = (bulletText || '').toLowerCase();
    var tl = (title || '').toLowerCase();
    var features = {};
    var findings = [];

    // 1. FACTUALITY — specific numbers and verifiable claims
    var hasNumbers = (bulletText.match(/\d+/g) || []).length;
    var hasSpecificUnits = /\d+\s*(lbs?|kg|oz|inch|cm|mm|ft|kw|w|v|hz|db|°|"|'')/i.test(bulletText);
    var hasSpecificModels = /[b B]0[A-Z0-9]{9}/.test(bulletText);
    features.FACTUALITY = hasNumbers >= 2 || hasSpecificUnits ? 2 : hasNumbers === 1 ? 1 : 0;
    findings.push(features.FACTUALITY >= 2 ? '✓ Specific numbers/units found' : features.FACTUALITY === 1 ? '◐ Partial numeric claims' : '✗ No specific numbers or units');

    // 2. USP — unique/differentiated features
    var uspSignals = /unique|patent|exclusive|proprietary|innovative|revolutionary|different|first ever|breakthrough/i.test(bt);
    var specificFeature = /(\d+\s*(lbs?|kg|oz|inch|cm|°|"|'')|stainless steel|copper|foam|compressor|cyclone|filter)/i.test(bt);
    features.USP = uspSignals || specificFeature ? 2 : 1;
    findings.push(features.USP >= 2 ? '✓ Differentiated feature claims' : '◐ Generic feature description');

    // 3. AUTHORITATIVENESS — confident, assertive; no vague words
    var vague = /\bmight\b|\bmaybe\b|\bperhaps\b|\bpossibly\b|\babout\b|\baround\b|\bsomewhat\b|\bprobably\b|\bmay\b|\bcould\b/.test(bt);
    var hasCert = /\bETL\b|\bUL\b|\bCE\b|\bcertified\b|\bFDA\b|\bNSF\b/i.test(bt);
    var strong = /\bensure\b|\bguarantees\b|\bdelivers\b|\bprovides\b|\boffers\b|\bfeatures\b|\bincludes\b|\bsupports\b|\boptimizes\b/.test(bt);
    features.AUTHORITATIVENESS = (!vague && strong) || hasCert ? 2 : !vague ? 1 : 0;
    findings.push(features.AUTHORITATIVENESS === 2 ? '✓ Assertive, confident tone + certifications' : features.AUTHORITATIVENESS === 1 ? '◐ Neutral tone' : '✗ Vague hedging language detected');

    // 4. SCANNABLE — structured for quick reading
    var hasSep = /[;|]/i.test(bulletText) || bulletText.split(/[;.]/).length >= 3;
    var hasColon = /:/i.test(bulletText);
    var hasDash = /[-–—]/i.test(bulletText);
    features.SCANNABLE = (hasSep || hasColon || hasDash) ? 2 : bulletText.length < 80 ? 1 : 0;
    findings.push(features.SCANNABLE === 2 ? '✓ Structured with separators/bullets' : features.SCANNABLE === 1 ? '◐ Short, scannable' : '✗ Dense paragraph block');

    // 5. USER INTENT alignment — addresses what shoppers actually ask
    // Does it answer Final Consideration questions (dimensions, warranty, safety, capacity)?
    var answersConsideration = /(\d+\s*(lbs?|kg|oz|inch|cm|mm|ft|°|"|'')|warranty|guarantee|dimension|size|capacity|weight|height|width|depth|voltage|power|energy|noise|decibel|db| safety|certified|ETL|UL|food.?grade|non.?toxic)/i.test(bt);
    // Does it address Exploration (what is it, what does it do)?
    var addressesExploration = /\bfor\b|\bideal\b|\bperfect\b|\bsuitable\b|\bgreat\b|\bhome\b|\bhouse\b|\boffice\b|\bhotel\b|\bbar\b|\brestaurant\b|\bparty\b/i.test(bt);
    // Does it address Comparison (vs alternatives)?
    var addressesComparison = /\unlike\b|\bversus\b|\bbetter\b|\bcompared\b|\bother\b|\balternatives\b/i.test(bt);
    features.USER_INTENT = answersConsideration ? 3 : addressesExploration ? 2 : 1;
    findings.push(answersConsideration ? '✓ Answers Final Consideration questions (specs/warranty/safety)' : addressesExploration ? '◐ Addresses Exploration stage (use cases)' : '✗ Does not address shopper questions');

    // 6. COMPETITIVENESS — favorable comparison WITHOUT violating rules
    // "Unlike..." is a violation — this is negative competitiveness
    var unlikeViolation = /\bunlike\b|\bversus\b|\bvs\.\b|\bcompare\b/i.test(bt);
    var positiveCompare = /\boutperforms\b|\bexceeds\b|\bsurpasses\b|\bsuperior\b|\bbetter than\b|\b优于\b|\b超过\b/i.test(bt);
    features.COMPETITIVENESS = unlikeViolation ? 0 : positiveCompare ? 2 : 1;
    findings.push(unlikeViolation ? '✗ Competitor comparison VIOLATION (unlike/versus)' : positiveCompare ? '✓ Positive differentiation claim' : '◐ No competitor comparison');

    // 7. SOCIAL PROOF — reviews/ratings mentioned
    var hasReviewSignal = /\bcustomers\b|\breviews\b|\bratings\b|\bpeople\b|\busers\b|\bowners\b|\bthousands\b|\bmillions\b|\bhighly rated\b|\bbest seller\b|\btop rated\b/i.test(bt);
    features.REVIEWS_RATINGS = hasReviewSignal ? 2 : 0;
    findings.push(hasReviewSignal ? '✓ Social proof present (reviews/ratings/best seller)' : '✗ No social proof signals');

    // 8. COMPELLING — engaging narrative that holds attention
    var emotional = /\bnevers?\b|\bsay goodbye\b|\bfarewell\b|\bcomfort\b|\benjoy\b|\blove\b|\bperfect\b|\bbest\b|\bultimate\b|\bno more\b|\bstop\b/i.test(bt);
    var powerWords = /\bseamlessly\b|\beffortlessly\b|\bconstant\b|\breliable\b|\bpowerful\b|\befficient\b|\bfast\b|\bspeed\b|\bboost\b|\benhance\b|\bimprove\b|\bmaximize\b|\boptimize\b/i.test(bt);
    features.COMPELLING = emotional || powerWords ? 2 : bulletText.length > 60 ? 1 : 0;
    findings.push(features.COMPELLING >= 2 ? '✓ Compelling, engaging language' : features.COMPELLING === 1 ? '◐ Functional, neutral language' : '✗ Dry, flat language');

    // 9. URGENCY — scarcity or clear next step
    var hasUrgency = /\bnow\b|\btoday\b|\blimited\b|\bonly\b|\bdon\'t miss\b|\bright now\b|\bin stock\b|\bavailable\b|\bget yours\b|\border now\b/i.test(bt);
    features.URGENCY = hasUrgency ? 2 : 1;
    findings.push(hasUrgency ? '✓ Urgency/scarcity signal present' : '◐ No urgency signal');

    // 10. RANKING — positions as top choice
    var rankingSignals = /\b#1\b|\bnumber one\b|\btop\b|\bbest\b|\bleading\b|\baward\b|\bchampion\b|\bwinner\b/i.test(bt);
    features.RANKING = rankingSignals ? 2 : 1;
    findings.push(rankingSignals ? '✓ Ranking/award claim' : '◐ No explicit ranking claim');

    return { features: features, findings: findings };
  },

  // Score a bullet overall (1-5) based on E-GEO feature scores
  // Weighted average focusing on what matters most for conversion
  scoreBullet: function(features) {
    var w = {
      FACTUALITY: 1.5,
      USP: 2.0,
      AUTHORITATIVENESS: 1.5,
      SCANNABLE: 1.0,
      USER_INTENT: 2.0,
      COMPETITIVENESS: 1.0,
      REVIEWS_RATINGS: 1.5,
      COMPELLING: 1.0,
      URGENCY: 0.5,
      RANKING: 1.0
    };
    var totalWeight = 0, weightedSum = 0;
    var ids = Object.keys(w);
    ids.forEach(function(id) {
      var score = features[id] || 0;
      var max = id === 'USER_INTENT' ? 3 : 2; // USER_INTENT goes to 3
      var normalized = score / max;
      weightedSum += normalized * w[id];
      totalWeight += w[id];
    });
    var raw = weightedSum / totalWeight * 5;
    return Math.max(1, Math.min(5, Math.round(raw * 10) / 10));
  },

  // Generate a recommendation for improving a bullet based on what it lacks
  recommendImprovement: function(features, findings) {
    var suggestions = [];
    if ((features.FACTUALITY || 0) < 2) suggestions.push('Add specific numbers: weight, dimensions, capacity, wattage');
    if ((features.USP || 0) < 2) suggestions.push('Emphasize what makes this product uniquely better');
    if ((features.AUTHORITATIVENESS || 0) < 2) suggestions.push('Use confident language; add certifications (ETL, UL, FDA)');
    if ((features.SCANNABLE || 0) < 2) suggestions.push('Use semicolons or colons to separate claims; break into sub-clauses');
    if ((features.USER_INTENT || 0) < 3) suggestions.push('Address specific shopper questions: exact dimensions, warranty period, safety certifications');
    if ((features.COMPETITIVENESS || 0) < 1) suggestions.push('Remove competitor comparison language ("unlike", "versus", "compare")');
    if (!features.REVIEWS_RATINGS) suggestions.push('Add social proof: "Thousands of happy customers", "Top-rated", "Best-seller"');
    if ((features.COMPELLING || 0) < 2) suggestions.push('Use power words: "Never run out", "Say goodbye to", "Constant fresh ice"');
    if ((features.URGENCY || 0) < 2) suggestions.push('Add clear call-to-action or scarcity signal');
    return suggestions;
  }
};
