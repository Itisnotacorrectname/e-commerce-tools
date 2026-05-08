# Listing Engine Merged — SKILL.md

## 概述

**listing-engine-merged** = Amazon Listing Rewrite Engine v2 + Walmart/Wayfair 扩展工具箱的合并产物。

**定位：** 一站式多平台 Listing 生成引擎，支持 Amazon 产品诊断 + 跨平台（Amazon/Walmart/Wayfair）转写

**状态：** 🟢 可用（74文件，8层完整，smoke_test 19/19 pass）

---

## 架构：8 Layer

```
listing-engine-merged/
├── index.js                  ← CLI 主入口
├── normalizer.js             ← 产品 Schema 标准化（规则 + LLM）
├── product_schema.js         ← Schema 定义
├── attribute_map.json        ← Walmart 属性标准化映射
├── walmart_composer.js       ← Walmart 文案组装
├── wayfair_composer.js       ← Wayfair 文案组装
│
├── core/                     ← 核心框架
│   ├── config.js             ← 全局配置（功能开关/LLM/平台限制）
│   ├── context.js            ← 全局数据总线
│   ├── pipeline.js           ← 执行调度器
│   └── registry.js          ← 模块注册表
│
├── layer1_data/              ← 数据抓取（Amazon scraper）
├── layer2_product/          ← 产品 intelligence（archetype/属性）
├── layer3_market/            ← 市场 intelligence（竞品/关键词/定价）
├── layer4_platform/         ← 平台 intelligence（类目/合规/标题构建）
├── layer5_conversion/        ← 核心转换引擎（intent→pain→hook→messaging + Cosmo评分）
├── layer6_composer/          ← 多平台组合输出
├── layer7_solver/            ← 约束求解（75char等平台限制）
├── layer8_constraints/        ← 平台规则引擎（禁词/长度/去重）
│
├── engines/                  ← 辅助引擎（keyword/compliance）
└── test/smoke_test.js        ← 冒烟测试
```

---

## 使用方式

### CLI

```bash
# 诊断模式（兼容 Amazon Listing Doctor）
node index.js diagnose <ASIN>

# 生成模式（指定目标平台）
node index.js generate <ASIN> --platforms=walmart,wayfair

# 转写模式（Amazon → Walmart/Wayfair）
node index.js transform <ASIN> --from=amazon --to=walmart,wayfair

# 运行冒烟测试
node test/smoke_test.js
```

### Node.js API

```js
const engine = require('./');

// 诊断模式
const result = await engine.diagnose('B0GVRS65WW');
// → { ctx with input/raw/product/market/platform/composed/reliability }

// 生成模式
const result = await engine.generate('B0F9P8NP97', ['walmart', 'wayfair']);

// 转写模式
const result = await engine.transform('B0F9P8MP39', 'amazon', ['walmart', 'wayfair']);
```

### 变体产品支持

支持带有 Color/Size 变体的产品（通过 `universal-scraper v2.0` 的 `scrape_with_variants.js` 抓取）：

```bash
# 1. 抓取父产品 + 所有变体
node "C:/Users/csbd/.openclaw/workspace/skills/universal-scraper - v2.0/scrape_with_variants.js" B0F9P8NP97 --folder "C:/variant_products/B0F9P8NP97"

# 2. 生成变体产品报告
node scripts/generate_variant_report.js "C:/variant_products/B0F9P8NP97"
# 输出：C:/variant_products/B0F9P8NP97/report.html

# 3. 用诊断结果跑 listing engine
node index.js diagnose B0F9P8NP97 --variants "C:/variant_products/B0F9P8NP97"
```

---

## Layer 职责表

| Layer | 职责 | 关键文件 |
|-------|------|---------|
| **layer1_data** | 抓取产品数据（Amazon via playwright） | `index.js` |
| **layer2_product** | Archetype 检测、属性/材质/颜色提取 | `index.js`, `rule_engine.js`, `scorer.js` |
| **layer3_market** | 竞品分析、关键词收集、定价定位 | `index.js` |
| **layer4_platform** | 类目匹配（Walmart/Wayfair）、合规检查、标题构建 | `index.js`, `walmart_adapter.js`, `title_builder.js`, `category_matcher.js` |
| **layer5_conversion** | intent/pain/hook/messaging 生成 + Cosmo 评分 | `index.js`, `scoring/scoring_engine.js` |
| **layer6_composer** | 多平台统一组合 | `index.js` |
| **layer7_solver** | 约束求解迭代（生成→评分→改写→选择） | `index.js`, `constraint_solver_v2.js` |
| **layer8_constraints** | 平台规则引擎（长度/禁词/去重） | `index.js`, `engine/constraint_engine.js` |

---

## 关键模块

### scoring_engine（Layer5 评分引擎）

```js
const { scoreMessagesV2 } = require('./layer5_conversion/scoring/scoring_engine.js');
const scored = scoreMessagesV2({
  messages: ['Best mattress for side sleepers'],
  platform: 'walmart',
  competitors: []
});
// → [{ text, score, breakdown: { clarity, emotion, specificity, differentiation, platform_fit } }]
```

### constraint_solver_v2（Layer7 约束求解）

```js
const { constraintSolverV2 } = require('./layer7_solver/constraint_solver_v2.js');
const result = constraintSolverV2({
  candidates: ['Premium Memory Foam Mattress'],
  platform: 'walmart',
  scorer: (texts) => texts.map(t => ({ text: t, score: 0.85 })),
  maxIterations: 3
});
```

### applyPlatformConstraints（Layer8 规则引擎）

```js
const { applyPlatformConstraints } = require('./layer8_constraints');
const fixed = applyPlatformConstraints({ title: 'Amazon Best Seller Mattress', bullets: ['...'] }, 'walmart');
// → 移除 Amazon/Prime/FBA 等禁词，截断到 75 字符
```

---

## 平台输出限制

| 平台 | Title 最大 | Bullets 最大 | 要求 |
|------|-----------|--------------|------|
| **Amazon** | 200 chars | 500 chars × 5 | 标题理想 100-180 |
| **Walmart** | 75 chars | 80 chars × 3-10 | 最少3条 |
| **Wayfair** | 70 chars | — | — |

---

## 已知限制

1. **Layer2** `rule_engine.js` 是简化版规则引擎，未使用完整 `rules/` 目录
2. **Layer3** `collectKeywords` 仅做简单频率统计，未用 TF-IDF
3. **Layer4** `category_matcher.js` 有 TF-IDF 和规则混合模式（可通过 `config.js.features.categoryMatching` 开关）
4. **Layer6 composer** 直接 require walmart_composer / wayfair_composer
5. **browser scrape** 需要网络连接，Amazon 反爬可能导致阻塞或 0 bytes 返回

---

## 环境要求

- Node.js ≥ 18
- `playwright`（`npm install playwright`）
- `universal-scraper v2.0`（位于 `skills/universal-scraper - v2.0/`）
- Chrome/Chromium（playwright 自动下载）

---

## 文件统计

- **总文件：74**（62 JS + 12 JSON）
- **Layer5（scoring）：** 7 文件（scoring_engine + 5 metrics + platform_weights）
- **Layer8：** 8 文件（constraint_engine + rule_runner + fixers + 3 rules JSON + text_utils + index）
- **ESM 文件：0**（全部已转换为 CommonJS）

---

## Changelog

### 2026-05-05
- smoke_test 3项失败修复（V1检测/competitorCount/origFlag）
- analyzePricing 完善（支持竞品价格计算 percentile/band/positioning）
- normalizer.js coreProduct 提取问题待修复（brand前缀移除）