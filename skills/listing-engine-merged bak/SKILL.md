# listing-engine-merged — SKILL.md

## 概述

Listing Engine Merged 是 Listing Engine v2（源A）和扩展工具箱（源B）的合并实现，提供三大功能：

1. **diagnose** — 诊断已有 Amazon listing（向后兼容 Amazon Listing Doctor）
2. **generate** — 从产品数据生成多平台 listing（Amazon / Walmart / Wayfair）
3. **transform** — 跨平台转写（Amazon → Walmart / Wayfair）

## 架构

```
index.js (主入口)
└── core/
    ├── pipeline.js   — 7层执行调度器
    ├── context.js    — 全局数据总线
    ├── registry.js   — 模块注册表
    ├── config.js     — 全局配置
    ├── normalizer.js — 产品数据标准化
    └── product_schema.js — 统一Schema验证
├── layer1_data/   — 数据抓取/清洗（源A）
├── layer2_product/ — 产品原型检测 + 属性提取（源A结构 + 源B规则引擎）
├── layer3_market/  — 竞品分析/关键词/价格定位（源A）
├── layer4_platform/ — 类目匹配/合规检查（源A）+ adapter/title_builder/highlight_builder（源B）
├── layer5_conversion/ — 转化引擎（源B完整实现：intent→pain→hook→proof→messaging→scoring）
├── layer6_composer/  — Walmart/Wayfair Composer（源A完整实现 + 源B验证）
├── layer7_solver/    — 约束求解器（源B constraint_solver_v2）
├── layer8_constraints/ — 合规规则引擎（源B新增）
└── test/smoke_test.js — 冒烟测试
```

## 核心模块

| 模块 | 来源 | 职责 |
|------|------|------|
| pipeline.js | 源A | 7层调度、错误处理、断点续跑 |
| context.js | 源A | 全局数据总线、dot-path读写、序列化 |
| normalizer.js | 源A | 规则提取 identity/attributes/features |
| layer5_conversion | 源B | scoring_engine (5维度评分) + intent/pain/hook/proof/messaging |
| walmart_composer.js | 源A | 75字符约束 + attribute_map + LLM压缩 |
| wayfair_composer.js | 源A | 三段式overview + spec饱和度 + Prop65 |
| layer7_solver | 源B | 迭代优化 + 去重 + 约束强制 |
| layer8_constraints | 源B | 平台规则引擎（amazon/walmart/wayfair） |

## 使用方式

```javascript
const engine = require('./listing-engine-merged');

// 诊断
await engine.diagnose('B0GJZSK34K');

// 生成多平台
await engine.generate('B0GJZSK34K', ['walmart', 'wayfair']);

// 跨平台转写
await engine.transform('B0GJZSK34K', 'amazon', ['walmart', 'wayfair']);
```

## CLI

```bash
node index.js diagnose  B0GJZSK34K
node index.js generate B0GJZSK34K --platforms=walmart,wayfair
node index.js transform B0GJZSK34K --from=amazon --to=walmart,wayfair
node index.js test
```

## 主要文件

- `core/pipeline.js` — 调度器
- `core/context.js` — 数据总线
- `layer5_conversion/index.js` — 转化引擎主入口
- `layer5_conversion/scoring/scoring_engine.js` — 5维度评分
- `layer6_composer/walmart_composer.js` — Walmart Composer
- `layer6_composer/wayfair_composer.js` — Wayfair Composer
- `layer7_solver/index.js` — 约束求解器
- `layer8_constraints/engine/constraint_engine.js` — 合规引擎
- `layer4_platform/walmart_adapter.js` — Walmart适配器
- `layer4_platform/title_builder.js` — 平台标题生成
- `layer4_platform/highlight_builder.js` — 平台highlights生成

## 平台约束

| 平台 | 标题限制 | 要点限制 |
|------|----------|----------|
| Amazon | 200字符 | 5条，每条500字符 |
| Walmart | 75字符 | 3-10条，每条80字符 |
| Wayfair | 70字符 | description 200词+ |

## 数据流

```
raw.product → normalizer → product.identity/attributes/features
                                ↓
                          layer2_product (archetype检测)
                                ↓
                          layer3_market (竞品/关键词/价格)
                                ↓
                          layer4_platform (类目匹配/合规)
                                ↓
                          layer5_conversion (intent/pain/hook/proof/messaging/scoring)
                                ↓
                          layer6_composer (walmart/wayfair生成) → composed.*
                                ↓
                          layer7_solver (约束求解) → solved.*
                                ↓
                          layer8_constraints (最终合规检查)
```

## 来源标注

- **源A**: `C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon listing rewrite\`
- **源B**: `C:\Users\csbd\Desktop\amazon listing rewrite to walmart and wayfair\`
