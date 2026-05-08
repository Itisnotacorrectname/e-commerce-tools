/**
 * layer2_product/feature_categorizer.js
 *
 * 职责：从 bullets + title 中提取特征句子，按 category 分类。
 * 规则驱动，无 LLM 依赖，结果 100% 可验证（附带原始文本出处）。
 *
 * 分类体系（与 product_schema.js FEATURE_CATEGORIES 对齐）：
 *   assembly      — 安装/组装相关
 *   storage       — 收纳/储物相关
 *   stability     — 稳定性/承重/防倾倒
 *   aesthetic     — 外观/风格/设计
 *   comfort       — 舒适度（坐感/睡感）
 *   safety        — 安全性（认证/无毒/防撞）
 *   compatibility — 兼容性（适配床架/车型/尺寸）
 *   durability    — 耐用性/寿命/材质坚固
 *   smart         — 智能功能（USB/LED/充电）
 *   eco           — 环保/认证（CertiPUR/FSC）
 *   convenience   — 便捷性（折叠/清洁/移动）
 *   other         — 不属于以上类别
 */

'use strict';

// ── 分类规则 ─────────────────────────────────────────────────
// 每个 category 有一组关键词/词组（大小写不敏感）。
// 匹配方式：phrase 直接包含在文本中（无需正则）。
// 优先级：按定义顺序匹配，第一个命中的 category 作为标签。

var CATEGORY_PATTERNS = [
  {
    category: 'assembly',
    phrases: [
      'easy to assemble', 'easy assembly', 'easy assemble', 'assembles easily',
      'assembly required', 'assembly needed', 'no assembly required', 'no assembly needed',
      'assembled in', 'assembles in', 'simple assembly', 'quick assembly',
      'tools included', 'tools required', 'hardware included', 'hardware provided',
      'easy to set up', 'easy setup', 'simple to set up', 'no tools required',
      'illustrated instructions', 'step-by-step instructions', 'detailed instructions',
      'easy to follow', 'easy-follow', 'comes with all necessary hardware',
      'pre-assembled', 'preassembled', 'out of the box', 'fully assembled',
    ]
  },
  {
    category: 'storage',
    phrases: [
      'storage space', 'storage bag', 'storage box', 'storage drawer', 'storage compartment',
      'under-bed storage', 'under bed storage', 'hidden storage', 'built-in storage',
      'extra storage', 'concealed storage', 'space-saving', 'space saving',
      'collapsible', 'foldable storage', 'stackable', 'organizer', 'storage solution',
      'storage capacity', 'storage pocket', 'storage basket', 'storage shelf',
    ]
  },
  {
    category: 'stability',
    phrases: [
      'sturdy', 'stable', 'steadily', 'wobble-free', 'wobble free', 'anti-wobble',
      'anti-sway', 'rock-solid', 'heavy-duty frame', 'heavy duty frame',
      'heavy-duty construction', 'reinforced corner', 'reinforced frame',
      'weight capacity', 'load capacity', 'weight capacity up to',
      'capacity up to', 'supports up to', 'holds up to',
      'non-slip feet', 'rubber feet', 'anti-slip', 'anti-tip', 'tip-resistant',
      'floor protection', 'scratch-resistant', 'anti-slip feet',
    ]
  },
  {
    category: 'aesthetic',
    phrases: [
      'modern design', 'sleek design', 'stylish', 'elegant', 'classic style',
      'contemporary', 'minimalist', 'minimal design', 'rustic', 'vintage style',
      'farmhouse', 'mid-century', 'scandinavian', 'bohemian', 'industrial style',
      'home decor', 'room decor', 'beautifully crafted', 'craftsmanship',
      'complements any room', 'complements your', 'visually appealing',
      'looks great', 'looks perfect', 'design look', 'design style',
      'available in multiple colors', 'comes in various colors',
      'color options', 'upholstered design', 'chic', 'sophisticated',
    ]
  },
  {
    category: 'comfort',
    phrases: [
      'comfortable', 'comfortably', 'cozy', 'soft', 'plush', 'cushioned',
      'ergonomic', 'lumbar support', 'seat comfort', 'relaxing',
      'padded armrest', 'padded seat', 'padded back', 'memory foam',
      'breathable', 'cloud-like', 'sink-in', 'ultra-soft',
    ]
  },
  {
    category: 'safety',
    phrases: [
      'safe', 'safety', 'non-toxic', 'bpa-free', 'lead-free', 'phthalate-free',
      'rounded corners', 'safe for children', 'safe for kids', 'child-safe',
      'pet-safe', 'flame retardant', 'fire retardant', 'certified safe',
      'safety certified', 'safety design', ' CertiPUR', 'CertiPUR-US',
      'CARB compliant', 'TSCA Title VI', 'formaldehyde free',
      'Proposition 65', 'Prop 65', 'P65 warning',
      'low VOC', 'eco-certified', 'ASTM certified',
    ]
  },
  {
    category: 'compatibility',
    phrases: [
      'fits all', 'fits any', 'fits most', 'fits standard',
      'compatible with', 'suitable for', 'universal fit',
      'twin size', 'full size', 'queen size', 'king size',
      'cal king size', 'standard size', 'adjustable to',
      'works with', 'designed to fit', 'universal design',
      'box spring required', 'box spring not required',
      'works with any', 'fits perfectly',
    ]
  },
  {
    category: 'durability',
    phrases: [
      'durable', 'durability', 'long-lasting', 'long lasting',
      'heavy-duty construction', 'heavy duty material', 'solid construction',
      'premium material', 'built to last', 'wear-resistant',
      'scratch-resistant', 'waterproof', 'water-resistant',
      'rust-proof', 'corrosion-resistant', 'stain-resistant',
      '1-year warranty', '2-year warranty', '3-year warranty',
      'limited warranty', 'year warranty', 'years warranty',
      'metal frame', 'solid wood', 'steel frame',
      'reinforced joints', 'solid build',
    ]
  },
  {
    category: 'smart',
    phrases: [
      'smart feature', 'smart design', 'smart technology',
      'built-in usb', 'built-in charging', 'usb port', 'usb charging',
      'wireless charging', 'led light', 'led lighting', 'led strip',
      'touch screen', 'touch control', 'automatic shut-off',
      'app-controlled', 'bluetooth', 'remote control',
      'voice control', 'programmable', 'digital display',
    ]
  },
  {
    category: 'eco',
    phrases: [
      'eco-friendly', 'eco friendly', 'sustainable',
      'recycled material', 'renewable', 'organic material',
      'FSC certified', 'recyclable', 'biodegradable',
      'carbon neutral', 'green product', 'low VOC',
      'certified foam', 'planet-friendly', 'reusable', 'compostable',
    ]
  },
  {
    category: 'convenience',
    phrases: [
      'convenient', 'easy to use', 'easy to clean', 'easy to maintain',
      'easy to move', 'easy to store', 'easy to transport',
      'wipe clean', 'spot clean', 'hand wash', 'machine wash',
      'dishwasher safe', 'dryer safe', 'removable cover',
      'portable', 'movable', 'lightweight', 'foldable',
      'easy fold', 'space-saving', 'no maintenance',
      'user-friendly', 'quick clean', 'hassle-free',
      'time-saving', 'labor-saving', 'ready to use',
      'easy care', 'simple care', 'easy storage',
    ]
  },
];

// ── 提取逻辑 ─────────────────────────────────────────────────

/**
 * 检查文本是否包含某个 phrase（大小写不敏感）。
 */
function containsPhrase(text, phrase) {
  return text.toLowerCase().indexOf(phrase.toLowerCase()) >= 0;
}

/**
 * 对单条文本进行分类。
 * @param {string} text   — 原始文本片段
 * @param {string} source — 来源标记，如 "bullet_1", "title"
 * @returns {{ text: string, category: string, source: string, verified: boolean }|null}
 */
function classifyPhrase(text, source) {
  var trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return null;

  var lower = trimmed.toLowerCase();
  // 跳过纯尺寸/重量数字串（如 "24.8 x 11.8 x 48 inches"）
  if (!/^[a-z]/i.test(trimmed)) return null;

  for (var i = 0; i < CATEGORY_PATTERNS.length; i++) {
    var cat = CATEGORY_PATTERNS[i];
    for (var j = 0; j < cat.phrases.length; j++) {
      if (containsPhrase(lower, cat.phrases[j])) {
        return { text: trimmed, category: cat.category, source: source, verified: true };
      }
    }
  }
  return { text: trimmed, category: 'other', source: source, verified: false };
}

/**
 * 将长文本切分成短句（按分号/句号/逗号分割）。
 */
function splitSentences(text) {
  if (!text) return [];
  return text
    .split(/[;；.。!！?？\,，]/)
    .map(function(s) { return s.trim(); })
    .filter(Boolean);
}

/**
 * 从 bullets + title 提取所有特征。
 * @param {string[]} bullets
 * @param {string} title
 * @returns {{ text: string, category: string, source: string, verified: boolean }[]}
 */
function extractFeatures(bullets, title) {
  var features = [];
  var seen = {};

  // 从 title 提取
  if (title) {
    var titleSentences = splitSentences(title);
    for (var i = 0; i < titleSentences.length; i++) {
      var result = classifyPhrase(titleSentences[i], 'title');
      if (result && !seen[result.text]) {
        seen[result.text] = true;
        features.push(result);
      }
    }
  }

  // 从 bullets 提取
  for (var b = 0; b < bullets.length; b++) {
    var bullet = bullets[b];
    var bulletSentences = splitSentences(bullet);
    for (var s = 0; s < bulletSentences.length; s++) {
      var result = classifyPhrase(bulletSentences[s], 'bullet_' + (b + 1));
      if (result && !seen[result.text]) {
        seen[result.text] = true;
        features.push(result);
      }
    }
  }

  return features;
}

/**
 * 按 category 分组，便于 composer 直接用。
 */
function groupByCategory(features) {
  var groups = {};
  for (var i = 0; i < features.length; i++) {
    var f = features[i];
    if (!groups[f.category]) groups[f.category] = [];
    groups[f.category].push(f);
  }
  return groups;
}

module.exports = { extractFeatures, groupByCategory, classifyPhrase, splitSentences };
