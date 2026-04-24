/**
 * bullet_analyzer.js
 *
 * E-GEO + p15 驱动的 bullets 分析引擎。
 * 核心方法论（来自 E-GEO paper + p15 paper）：
 *
 * E-GEO 10特征：
 *   RANKING/USER_INTENT/COMPETITIVENESS/REVIEWS_RATINGS/COMPELLING/
 *   AUTHORITATIVENESS/USP/URGENCY/SCANNABLE/FACTUALITY
 *
 * p15 购物三阶段：
 *   Exploration → Comparison → Final Consideration
 *   对应 Rufus 5问：Use Case / Dimensions / Durability / Warranty / Safety
 *
 * 检测规则（非硬编码产品数据，通用逻辑）：
 *
 * FACTUALITY: 数密度 + 模糊词检测
 *   - 数字出现频率（\d+\s*(lbs|kg|cm|mm|inch|oz|hrs?|mins?|pcs?|°） → +1
 *   - 模糊最高级（best/great/amazing/perfect） → -0.5
 *   - 无数字段落 → 低分
 *
 * COMPETITIVENESS: 违规词检测（Amazon政策）
 *   - unlike / versus / compared to / other brands / competitors → 直接0 + flag
 *
 * AUTHORITATIVENESS: 认证 + 认证号
 *   - ETL / UL / CE / FCC / DOE / Energy Star → +1
 *   - 后面跟数字（认证号）→ 额外+0.5
 *
 * USP: 差异化词 + 数字
 *   - unique / patented / exclusive / advanced / proprietary → +1
 *   - 专业参数词（commercial grade / stainless steel / copper tube）→ +1
 *
 * URGENCY: 时间/库存压力
 *   - limited / available / order now / today only / while supplies → +1
 *
 * SCANNABLE: 结构化程度
 *   - 换行/bullet符号 → +1
 *   - 全篇超过40词无分段 → -1
 *
 * p15 购物阶段映射：
 *   Use Case: 场景词（home/kitchen/office/restaurant/bar/camping/RV）
 *   Dimensions: 数字 + 单位
 *   Durability: 材料词（stainless steel/copper/PP/foam）+ 保修
 *   Warranty: 时间周期（months/years）+ guarantee
 *   Safety: 认证词（ETL/UL/food-grade/non-toxic）
 */

var path = require('path');

module.exports = {

  /**
   * 分析单条 bullet
   * @param {string} bullet - 原始 bullet 文本
   * @param {number} bulletNum - 第几条（1-5）
   * @param {object} context - { title, asin }
   * @returns {object} 分析结果
   */
  analyzeOne: function(bullet, bulletNum, context) {
    var findings = [];
    var suggestions = [];
    var score = { egeo: {}, rufus: {} };

    // ── 检测 COMPETITIVENESS 违规（最重要，先检）──────────────
    var violationPattern = /\b(unlike|versus|vs\.?|compared to|other brands?|competitors?)\b/i;
    var hasViolation = violationPattern.test(bullet);
    score.egeo.COMPETITIVENESS = hasViolation ? 0 : null; // null = 未评分

    if (hasViolation) {
      findings.push('✗ COMPETITIVENESS违规：发现贬低竞品表述（unlike/versus等）');
      suggestions.push('移除\"Unlike\"类表述，改为正面差异化表达');
    }

    // ── 检测 FACTUALITY ─────────────────────────────────────
    var numbers = bullet.match(/\d+\s*(lbs?|kg|cm|mm|inch|oz|hrs?|mins?|pcs?|°[CF]?|w|v|a|db|dba)?/gi) || [];
    var vague = bullet.match(/\b(best|great|amazing|perfect|excellent|good|high quality|low quality|fast|quick)\b/gi) || [];
    var wordCount = bullet.split(/\s+/).length;
    // FACTUALITY: 有数字就给1.5+；3+数字给2；模糊词扣0.25
    var vaguePen = vague.length >= 2 ? 0.5 : vague.length >= 1 ? 0.25 : 0;
    var factuality = numbers.length >= 3 ? 2 : numbers.length >= 1 ? 1.5 + (1 - vaguePen) * 0.25 : 1.0 - vaguePen;
    factuality = Math.min(2, Math.max(0.5, factuality));
    score.egeo.FACTUALITY = factuality;

    if (numbers.length === 0) {
      findings.push('◐ FACTUALITY弱：无具体数字规格');
      suggestions.push('添加具体数字（容量/重量/尺寸/产出量）');
    } else if (numbers.length >= 3) {
      findings.push('✓ FACTUALITY强：' + numbers.length + '个具体数字');
    }

    // ── 检测 AUTHORITATIVENESS ───────────────────────────────
    var certs = bullet.match(/\b(ETL|UL|CE|FCC|DOE|Energy Star|CSA|ISO|certified|certification|tested)\b/gi) || [];
    var certNumbers = bullet.match(/\d{4,}[A-Z0-9]{2,}/g) || []; // 认证号格式
    var authoritativeness = certs.length >= 1 ? (certNumbers.length >= 1 ? 2 : 1.5) : 1.5;
    score.egeo.AUTHORITATIVENESS = authoritativeness;

    if (certs.length >= 1) {
      findings.push('✓ AUTHORITATIVENESS：有认证支撑（' + certs.join('/') + '）');
      if (certNumbers.length === 0) {
        suggestions.push('添加认证编号（方便买家验证）');
      }
    }

    // ── 检测 USP ────────────────────────────────────────────
    var uspWords = /\b(unique|patented|exclusive|proprietary|advanced|professional|commercial grade|industrial)\b/gi;
    var uspMatches = bullet.match(uspWords) || [];
    var hasUsp = uspMatches.length > 0 || (numbers.length >= 2 && certs.length >= 1);
    score.egeo.USP = hasUsp ? (uspMatches.length >= 2 ? 2 : 1.5) : 1.5;

    if (uspMatches.length > 0) {
      findings.push('✓ USP明确：' + uspMatches.slice(0,2).join('/'));
    }

    // ── 检测 URGENCY ────────────────────────────────────────
    var urgencyWords = /\b(limited|available now|order now|today only|while supplies|last few|in stock|don\'t miss)\b/gi;
    var urgencyMatches = bullet.match(urgencyWords) || [];
    score.egeo.URGENCY = urgencyMatches.length > 0 ? 2 : 1.5;
    if (urgencyMatches.length === 0) {
      suggestions.push('添加紧迫感词（limited/available now/while supplies）提升 urgency');
    }

    // ── 检测 SCANNABLE ──────────────────────────────────────
    var hasNewline = bullet.indexOf('\n') !== -1 || bullet.indexOf('•') !== -1 || bullet.indexOf('- ') !== -1;
    var hasLongPara = bullet.length > 200 && !hasNewline;
    var scannable = hasNewline ? 2 : hasLongPara ? 1 : 1.5;
    score.egeo.SCANNABLE = scannable;
    if (hasLongPara) {
      suggestions.push('分段处理：使用换行或 bullet 符号提升可扫读性');
    }

    // ── 检测 COMPELLING ─────────────────────────────────────
    var emotionWords = /\b(never|always|finally|say goodbye|bid farewell|discover|transform|imagine)\b/gi;
    var emotionMatches = bullet.match(emotionWords) || [];
    var compelling = emotionMatches.length >= 2 ? 2 : emotionMatches.length >= 1 ? 1.5 : 1;
    score.egeo.COMPELLING = compelling;

    // ── 检测 REVIEWS_RATINGS ────────────────────────────────
    var reviewWords = /\b(customers say|reviews|rated|rating|\d+[\.\d]* stars|best seller|top rated)\b/gi;
    var reviewMatches = bullet.match(reviewWords) || [];
    score.egeo.REVIEWS_RATINGS = reviewMatches.length > 0 ? 2 : 1;
    if (reviewMatches.length === 0) {
      suggestions.push('如有评分数据，添加 social proof（\"4.4 stars, 500+ reviews\"）');
    }

    // ── USER_INTENT（综合） ────────────────────────────────
    // 根据数字密度 + USP + 场景词 估算
    var sceneWords = /\b(home|kitchen|office|restaurant|bar|cafe|camping|RV|hotel|party|commercial|home bar)\b/gi;
    var sceneMatches = bullet.match(sceneWords) || [];
    var userIntent = (numbers.length >= 2 ? 1 : 0) + (sceneMatches.length >= 1 ? 1 : 0) + (hasUsp ? 1 : 0);
    score.egeo.USER_INTENT = Math.min(3, Math.max(1, userIntent));

    if (sceneMatches.length >= 2) {
      findings.push('✓ USER_INTENT强：覆盖多场景（' + sceneMatches.slice(0,3).join('/') + '）');
    }

    // ── RANKING（综合均值，排除COMPETITIVENESS违规） ──────
    var ratedKeys = Object.keys(score.egeo).filter(function(k) { return score.egeo[k] !== null && k !== 'COMPETITIVENESS'; });
    var sumEgeo = ratedKeys.reduce(function(s, k) { return s + score.egeo[k]; }, 0);
    score.egeo.RANKING = ratedKeys.length > 0 ? Math.round((sumEgeo / ratedKeys.length) * 2) / 2 : 1.5;

    // ── p15 Rufus 5问 ───────────────────────────────────────

    // Q1 Use Case：场景词
    var q1 = sceneMatches.length >= 2 ? 5 : sceneMatches.length >= 1 ? 4 : 3;
    score.rufus.Q1_UseCase = { score: q1, reason: sceneMatches.length >= 2
      ? '覆盖多个使用场景'
      : sceneMatches.length >= 1
      ? '提到部分使用场景'
      : '无明确使用场景说明' };

    // Q2 Dimensions：数字+单位
    var dimNums = bullet.match(/\d+\s*(lbs?|kg|cm|mm|inch|oz|gal|liter|°|x\s*\d)/gi) || [];
    var q2 = dimNums.length >= 3 ? 5 : dimNums.length >= 1 ? 4 : 2;
    score.rufus.Q2_Dimensions = { score: q2, reason: dimNums.length >= 3
      ? '有详细尺寸重量规格（' + dimNums.slice(0,3).join(', ') + '）'
      : dimNums.length >= 1
      ? '提到部分规格数字'
      : '缺少具体尺寸/重量数字' };

    // Q3 Durability：材料词 + 保修
    var materialWords = /\b(stainless steel|copper|aluminum|plastic|PP|PE|foam|cyclone|compressor|durab)\b/gi;
    var materialMatches = bullet.match(materialWords) || [];
    var warrantyWords = /\b(warranty|guarantee|years?|months?|coverage)\b/gi;
    var warrantyMatches = bullet.match(warrantyWords) || [];
    var q3 = (materialMatches.length >= 2 && warrantyMatches.length >= 1) ? 5
      : materialMatches.length >= 1 ? 3 : 2;
    score.rufus.Q3_Durability = { score: q3, reason: materialMatches.length >= 2
      ? '列出材料（' + materialMatches.slice(0,2).join('/') + '）+ 保修'
      : materialMatches.length >= 1
      ? '提到材料但无保修信息'
      : '缺少耐用性具体说明' };

    // Q4 Warranty：时间周期
    var periodNums = bullet.match(/\d+\s*(year|month|day|hour)s?\b/gi) || [];
    var hasGuarantee = /\b(guarantee|warranty|coverage|assurance)\b/i.test(bullet);
    var q4 = periodNums.length >= 1 && hasGuarantee ? 5
      : periodNums.length >= 1 ? 4
      : hasGuarantee ? 3 : 2;
    score.rufus.Q4_Warranty = { score: q4, reason: periodNums.length >= 1
      ? '有具体保修期（' + periodNums[0] + '）'
      : hasGuarantee
      ? '提到保修但无具体时间'
      : '缺少保修信息（高权重：买家核心顾虑）' };

    // Q5 Safety：认证
    var safetyWords = /\b(ETL|UL|CE|FCC|DOE|Energy Star|food.safe|food.grade|non.toxic|BPA.free|safe)\b/gi;
    var safetyMatches = bullet.match(safetyWords) || [];
    var q5 = safetyMatches.length >= 2 ? 5 : safetyMatches.length >= 1 ? 4 : 2;
    score.rufus.Q5_Safety = { score: q5, reason: safetyMatches.length >= 1
      ? '有安全认证：' + safetyMatches.slice(0,2).join('/')
      : '缺少安全认证说明' };

    // ── Overall ────────────────────────────────────────────
    var allEgeo = Object.keys(score.egeo).filter(function(k) { return score.egeo[k] !== null; });
    var totalEgeo = allEgeo.reduce(function(s, k) { return s + score.egeo[k]; }, 0);
    var overall = Math.round((totalEgeo / allEgeo.length) * 2) / 2;

    // Deduplicate suggestions
    var uniqueSuggestions = [];
    suggestions.forEach(function(s) {
      if (uniqueSuggestions.indexOf(s) === -1) uniqueSuggestions.push(s);
    });

    return {
      bulletNum: bulletNum,
      overallScore: overall,
      egeoScores: score.egeo,
      rufusScores: {
        Q1_UseCase: score.rufus.Q1_UseCase,
        Q2_Dimensions: score.rufus.Q2_Dimensions,
        Q3_Durability: score.rufus.Q3_Durability,
        Q4_Warranty: score.rufus.Q4_Warranty,
        Q5_Safety: score.rufus.Q5_Safety
      },
      findings: findings.length > 0 ? findings : ['◐ 中规中矩，无明显亮点也无违规'],
      suggestions: uniqueSuggestions.slice(0, 4)
    };
  },

  /**
   * 分析全部 bullets
   * @param {string[]} bullets - bullet 数组（通常5条）
   * @param {string} title - 产品标题
   * @param {string} asin - ASIN
   * @returns {object[]} 每条的分析结果
   */
  analyzeBullets: function(bullets, title, asin) {
    var self = this;
    var results = (bullets || []).map(function(b, i) {
      return self.analyzeOne(b, i + 1, { title: title, asin: asin });
    });

    // Average scores
    var allEgeoKeys = ['RANKING','USER_INTENT','COMPETITIVENESS','REVIEWS_RATINGS','COMPELLING','AUTHORITATIVENESS','USP','URGENCY','SCANNABLE','FACTUALITY'];
    var avg = {};
    allEgeoKeys.forEach(function(k) {
      var vals = results.filter(function(r) { return r.egeoScores[k] !== null; }).map(function(r) { return r.egeoScores[k]; });
      if (vals.length > 0) {
        avg[k] = Math.round((vals.reduce(function(a, b) { return a + b; }, 0) / vals.length) * 2) / 2;
      }
    });

    // p15 averages
    var rufusAvg = {};
    ['Q1_UseCase','Q2_Dimensions','Q3_Durability','Q4_Warranty','Q5_Safety'].forEach(function(q) {
      var vals = results.map(function(r) { return r.rufusScores[q].score; });
      rufusAvg[q] = Math.round((vals.reduce(function(a, b) { return a + b; }, 0) / vals.length) * 2) / 2;
    });

    return {
      bullets: results,
      averageEgeo: avg,
      averageRufus: rufusAvg,
      overallAverage: Math.round(Object.keys(avg).reduce(function(s, k) { return s + avg[k]; }, 0) / Object.keys(avg).length * 2) / 2
    };
  }
};
