/**
 * product_schema.js — Amazon Listing Doctor v2
 *
 * 统一 Product Schema：所有平台、所有引擎的数据合同。
 * 所有 Engine 只读此 Schema，不直接读平台原始数据。
 *
 * 设计原则：
 *   - 完全通用，品类无关
 *   - 每个字段标注数据来源（text / image / llm）
 *   - 每个 LLM 推断字段带 confidence 和 evidence
 *   - 空值用 null，不用空字符串
 */

'use strict';

// ── Schema 默认值工厂 ─────────────────────────────────────────
// 调用 createSchema() 生成一个空的合规 Schema 实例

function createSchema() {
  return {

    // ── 元数据 ────────────────────────────────────────────────
    meta: {
      asin:        null,   // string
      platform:    null,   // "amazon" | "walmart" | "wayfair" | "tiktok" | ...
      marketplace: null,   // "US" | "UK" | "DE" | "JP" | ...
      url:         null,   // string
      scrapedAt:   null,   // ISO 8601 string
      schemaVersion: '2.0'
    },

    // ── 原始数据快照（只读，不修改）─────────────────────────
    // 来源：爬虫直接抓取，Normalizer 读取后转换，不再修改此层
    raw: {
      title:       null,   // string
      bullets:     [],     // string[]
      description: null,   // string（有些平台有长描述）
      price:       null,   // number
      currency:    null,   // "USD" | "GBP" | ...
      rating:      null,   // number (e.g. 4.3)
      reviewCount: null,   // number
      BSR:         null,   // number | null
      category:    null,   // string，完整路径如 "Home & Kitchen > Furniture > ..."
      brand:       null,   // string
      images:      [],     // string[]（图片 URL 列表，主图在 [0]）
      backend:     null,   // string（Amazon backend search terms，其他平台为 null）
    },

    // ── 核心产品识别 ─────────────────────────────────────────
    // 来源：text_extractor（规则） + llm 辅助
    identity: {
      coreProduct:    null,  // string，核心品类词，如 "bed frame"
      brand:          null,  // string
      modelNumber:    null,  // string | null
      variantSignals: [],    // string[]，如 ["Queen", "Black", "14 inch"]
                             // 来源：title 里的 size/color/material 信号词
    },

    // ── 属性层（通用信号，品类无关）──────────────────────────
    // 来源：text_extractor（规则提取） + image_analyzer（补充）
    // 每个字段有 source 标注
    attributes: {

      // 尺寸信号（数字 + 单位）
      dimensions: {
        raw:        [],     // string[]，原始尺寸字符串，如 ["14 inch height", "60\" x 80\""]
        parsed:     [],     // { value: number, unit: string, dimension: string }[]
                            // dimension: "height" | "width" | "depth" | "diameter" | "weight" | "capacity" | "unknown"
        source:     null,   // "text" | "image" | "both"
      },

      // 材质信号
      materials: {
        raw:        [],     // string[]，原始材质词，如 ["steel", "velvet", "solid wood"]
        source:     null,   // "text" | "image" | "both"
      },

      // 颜色信号
      colors: {
        raw:        [],     // string[]，如 ["black", "beige", "rustic brown"]
        source:     null,   // "text" | "image" | "both"
      },

      // 承重/容量信号
      capacity: {
        raw:        [],     // string[]，如 ["800 lbs", "holds up to 50 lbs per shelf"]
        parsed:     [],     // { value: number, unit: string }[]
        source:     null,   // "text" | "image" | "both"
      },

      // 认证信号
      certifications: {
        raw:        [],     // string[]，如 ["CertiPUR-US", "CARB compliant", "CE"]
        source:     'text', // 认证只来自文字，图片里的认证徽标暂不解析
      },

      // 安全/合规声明
      safetyClaims: {
        raw:        [],     // string[]，如 ["BPA-free", "lead-free", "non-toxic", "rounded corners"]
        source:     null,   // "text" | "image" | "both"
      },

      // 关键功能规格（数字化的技术参数）
      specs: {
        raw:        [],     // { key: string, value: string }[]，如 [{ key: "wattage", value: "1500W" }]
        source:     null,
      },

    },

    // ── 功能特征层（结构化提取）─────────────────────────────
    // 来源：text_extractor（规则 + 关键词模式）
    // 是"产品说了什么"，100% 可验证（有原始文本出处）
    features: [
      // {
      //   text:       string,   // 功能描述原文片段
      //   category:   string,   // "assembly" | "storage" | "stability" | "aesthetic" |
      //                         // "comfort" | "safety" | "compatibility" | "durability" |
      //                         // "smart" | "eco" | "other"
      //   source:     string,   // "title" | "bullet_1" | ... | "bullet_5" | "description"
      //   verified:   boolean,  // Fact-Check 是否验证过
      // }
    ],

    // ── 使用场景层（语义标签，LLM 推断）────────────────────
    // 来源：llm（从 raw.title + raw.bullets 推断）+ image_analyzer（辅助）
    // 是"买家视角"，需要 confidence + evidence
    useCases: [
      // {
      //   label:       string,   // 场景标签，如 "home office", "small apartment", "gifting"
      //   confidence:  number,   // 0-1，LLM 置信度
      //   evidence:    string[], // 支撑该标签的原始文本片段
      //   source:      string,   // "text" | "image" | "both"
      // }
    ],

    // ── 目标用户层（两个维度）───────────────────────────────
    // 来源：llm（从全部文本推断）
    targetAudience: {

      // 人口统计维度
      demographic: [
        // {
        //   label:      string,   // "adults" | "children" | "seniors" | "couples" | "families" | ...
        //   confidence: number,
        //   evidence:   string[],
        // }
      ],

      // 使用情境维度
      situational: [
        // {
        //   label:      string,   // "first-time buyers" | "renters" | "college students" |
        //                         // "homeowners" | "remote workers" | "gamers" | ...
        //   confidence: number,
        //   evidence:   string[],
        // }
      ],
    },

    // ── 关键词层 ─────────────────────────────────────────────
    // 来源：keyword_engine（基于竞品分析）
    // 由 keyword_engine 写入，Normalizer 不生成此层
    keywords: {
      primary:    [],   // { keyword: string, freq: string, note: string }[]
      secondary:  [],   // { keyword: string, freq: string, note: string }[]
      backend:    [],   // string[]
      sizeSignals: [],  // string[]（从竞品标题提取的规格词）
      competitorCount: null, // number，参与分析的竞品数
    },

    // ── 图片分析层 ───────────────────────────────────────────
    // 来源：image_analyzer
    // 每次诊断都运行，补充 attributes 和 useCases 无法从文字提取的信号
    imageAnalysis: {
      mainImage: {
        url:              null,    // string
        detectedColors:   [],      // string[]，图片实际颜色
        detectedMaterials: [],     // string[]，从视觉识别的材质
        usageContext:     [],      // string[]，图片显示的使用场景（如 "bedroom setup", "office desk"）
        productAngle:     null,    // "front" | "side" | "top" | "lifestyle" | "detail" | "infographic"
        hasTextOverlay:   false,   // boolean，是否有文字标注
        textOverlayContent: [],    // string[]，图片上的文字内容
        qualitySignals: {
          isWhiteBackground: null, // boolean
          hasLifestyleShot:  null, // boolean
          hasDimensionDiagram: null, // boolean
        },
      },
      additionalImages: [], // 与 mainImage 结构相同，副图分析
      consistencyCheck: {
        // 图文一致性验证
        colorMatch:    null,   // boolean | null，图片颜色是否与文字颜色描述一致
        materialMatch: null,   // boolean | null
        conflicts:     [],     // string[]，发现的图文矛盾
      },
    },

    // ── 合规层 ───────────────────────────────────────────────
    // 来源：compliance_engine
    // 由 compliance_engine 写入
    compliance: {
      explicit: [],    // 显性违规 V1-V8
      implicit: [],    // 隐性违规 V9-V18
      riskLevel: null, // "low" | "medium" | "high" | "critical"
      factCheckResults: [], // Fact-Check 对 features 和 useCases 的验证结果
    },

    // ── 意图层 ───────────────────────────────────────────────
    // 来源：intent_engine（Rufus 模拟）
    intent: {
      questions:    [],    // string[]，EXACTLY 3 个
      cosmoScores:  [],    // { question, score, label, evidence, enhancement }[]
      averageScore: null,  // number
    },

    // ── 平台输出层 ───────────────────────────────────────────
    // 来源：各平台 Composer
    // 每个平台的 Composer 写入对应字段，不相互干扰
    output: {
      amazon: {
        title:      null,  // string
        titleChars: null,  // number
        bullets:    [],    // string[]
        backend:    null,  // string
        byteCount:  null,  // number
      },
      walmart: {
        title:            null,
        shortDescription: null,
        keyFeatures:      [],
        attributes:       {},  // { color, material, size, ... }（Walmart 属性表）
      },
      wayfair: {
        title:       null,
        description: null,
        specs:       {},   // { dimensions, finish, roomType, ... }
      },
    },

    // ── 诊断报告层 ───────────────────────────────────────────
    // 来源：scoring_engine + report_gen
    diagnosis: {
      qualityScore: null,   // number 0-100
      qualityGrade: null,   // "A+" | "A" | "B+" | "B" | "C" | "D" | "F"
      actionPlan:   [],     // { priority, action, location, impact, execType }[]
      pendingData:  [],     // { dataType, usedFor, purpose }[]
    },

  };
}

// ── 字段验证 ─────────────────────────────────────────────────
// 验证 Schema 实例的必填字段是否存在
function validate(schema) {
  var errors = [];

  if (!schema.meta.asin)     errors.push('meta.asin is required');
  if (!schema.meta.platform) errors.push('meta.platform is required');
  if (!schema.raw.title)     errors.push('raw.title is required');

  return {
    valid:  errors.length === 0,
    errors: errors
  };
}

// ── 浅合并：把 patch 对象的字段合并到 schema ─────────────────
// 用于 Normalizer 各子模块逐步填充 Schema
function merge(schema, path, value) {
  var parts = path.split('.');
  var obj = schema;
  for (var i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  return schema;
}

// ── Platform 枚举 ─────────────────────────────────────────────
var PLATFORMS = {
  AMAZON:  'amazon',
  WALMART: 'walmart',
  WAYFAIR: 'wayfair',
  TIKTOK:  'tiktok',
  ETSY:    'etsy',
};

// ── Feature category 枚举 ─────────────────────────────────────
var FEATURE_CATEGORIES = [
  'assembly',      // 安装/组装相关
  'storage',       // 收纳/储物
  'stability',     // 稳定性/承重
  'aesthetic',     // 外观/风格
  'comfort',       // 舒适度
  'safety',        // 安全性
  'compatibility', // 兼容性
  'durability',    // 耐用性
  'smart',         // 智能功能（LED/USB/充电）
  'eco',           // 环保/认证
  'convenience',   // 便捷性（易清洁/可折叠等）
  'other',
];

// ── UseCase label 枚举（开放扩展，LLM 可输出此列表以外的标签）─
var USE_CASE_LABELS = [
  // 空间场景
  'home office', 'bedroom', 'living room', 'kitchen', 'outdoor', 'dorm room',
  'small apartment', 'studio', 'guest room',
  // 使用场景
  'gaming', 'remote work', 'studying', 'entertaining', 'storage', 'gifting',
  // 用户场景
  'first-time buyers', 'renters', 'homeowners', 'moving in',
];

module.exports = {
  createSchema,
  validate,
  merge,
  PLATFORMS,
  FEATURE_CATEGORIES,
  USE_CASE_LABELS,
};
