# Amazon Listing Doctor v2.6 -mimo

基于 v2.3 架构，加入 v2.4 的核心优化，开源零依赖。

## 版本差异

### v2.3（底座）
- ✅ 清洁架构：ARCHITECTURE.md + kb_rules.js 模块化
- ✅ 开源零依赖：skill 自包含，不依赖外部 KB
- ✅ LLM 降级：pattern fallback，LLM 挂了不会输出垃圾
- ⚠️ 缺陷：coreProduct 提取不够精准（未用 category 信号加权）

### v2.4（改进来源）
- ✅ category-weighted coreProduct 提取（catBoost 打分）
- ✅ GENERIC_PARENTS 过滤（equipment/furniture 等父级词）
- ✅ smart fallback（category 与 title 交叉验证）
- ⚠️ 缺陷：硬编码私人 KB 路径，不适合开源

### v2.6（目标）
- ✅ 保留 v2.3 的清洁架构和零依赖
- ✅ 加入 v2.4 的 category-weighted 核心产品提取
- ✅ Fact-Check（G.5）已在 SKILL.md 定义，需实现代码
- ✅ 动态 bullet 排序已在 SKILL.md 定义
- ✅ E-GEO 10 维度（V9-V18）已在 SKILL.md 定义

## 核心改进（来自 v2.4）

### 1. category-weighted bigram 打分
```javascript
// 例：category 末段 "Dip Stands" → catLastWords = {dip, stand}
// "dip stand" catBoost=2, "bar stand" catBoost=1
// 排序时：dip stand 排在 bar stand 前面
var catBoost = (catLastWords.has(words[i]) ? 1 : 0) + (catLastWords.has(words[i + 1]) ? 1 : 0);
```

### 2. GENERIC_PARENTS 过滤
```javascript
var GENERIC_PARENTS = new Set(['equipment','furniture','products','items','accessories','supplies']);
var useParent = prevModifiers.length > 0 && !GENERIC_PARENTS.has(prevModifiers[prevModifiers.length - 1]);
```

### 3. smart fallback（category 与 title 交叉验证）
```javascript
// 例：category 组合 "equipment dip stand" → title 中 "equipment" 不在独立位置 → 过滤
var validatedWords = catCombined.split(/\s+/).filter(function(w) {
  return titleWords.indexOf(w) !== -1;
});
```

## 文件结构

```
skills/amazon-listing-doctor-v2.6/
├── diagnose.js              # 数据层：step1-4 爬虫 + category-weighted coreProduct
├── report_gen.js            # 渲染层：读 checkpoints → 生成 HTML/PDF
├── inject_analysis.js       # JSON 路线：analysis.json → step5-14.json → 报告
├── md_to_checkpoints.js     # md 路线：analysis.md → step5-14.json → 报告
├── SKILL.md                 # 分析层：完整分析逻辑（V1-V18 内联）
├── references/
│   ├── rufus_test.md        # Rufus 意图问题生成模板
│   ├── cosmo_evaluation.md  # Cosmo 0/3/5 评分框架
│   └── violation_rules.md   # V1-V18 完整规则（待创建）
├── knowledge/
│   └── README.md            # 可选用户知识库（skill 本身自包含）
└── lib/
    └── amazon_scraper.js    # Playwright 爬虫核心

workspace/amazon-listing-doctor/   ← 用户数据，不随 skill 升级删除
├── checkpoints/[ASIN]/            # 每步 JSON checkpoint + analysis.md
└── reports/[ASIN]/                # HTML/PDF 报告
```

## 使用方式

```bash
# Phase 1: 数据抓取
node skills/amazon-listing-doctor-v2.6/diagnose.js B09PV32NNK

# Phase 2: Claude 分析（按 SKILL.md 步骤执行）
# Phase 3: 生成报告
node skills/amazon-listing-doctor-v2.6/report_gen.js B09PV32NNK
```

## 开源就绪

✅ **零外部依赖** — skill 自包含所有规则
✅ **无硬编码路径** — 不依赖 Kane 私人 KB
✅ **模块化架构** — 可测试、可替换
✅ **LLM 降级** — pattern fallback 防崩溃

## 待实现（v2.6 完整版）

- [ ] Fact-Check（G.5）代码实现（diagnose.js step9）
- [ ] 动态 bullet 排序代码实现（diagnose.js step9）
- [ ] violation_rules.md 创建（V1-V18 完整规则）
