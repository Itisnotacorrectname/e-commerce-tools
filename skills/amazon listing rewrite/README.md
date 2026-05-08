# Listing Engine v2

E-commerce Multi-Platform Listing Intelligence System

## 架构概览

```
listing-engine/
├── index.js                    # 主入口（3种模式：diagnose / generate / transform）
├── normalizer.js               # 产品数据标准化（规则提取层）
├── product_schema.js           # 统一 Product Schema 定义
│
├── core/
│   ├── pipeline.js             # 执行调度器（控制7层流程）
│   ├── context.js              # 全局数据总线（跨层数据流）
│   ├── registry.js             # 模块注册表（解耦/可替换）
│   └── config.js               # 全局配置（功能开关/权重/模型）
│
├── layer0_reliability/
│   └── index.js                # 可靠性层：置信度评分/缺失检测/来源追踪
│
├── layer1_data/
│   └── index.js                # 数据层：读取 checkpoint / 清洗 / 导入评论
│
├── layer2_product/
│   └── index.js                # 产品智能：archetype检测 / 属性提取 / 图片分析
│
├── layer3_market/
│   └── index.js                # 市场智能：竞品分析 / 关键词 / 价格定位
│
├── layer4_platform/
│   ├── category_matcher.js     # 四阶段类目匹配（TF-IDF + 属性验证 + 规则 + 平台逻辑）
│   ├── compliance_runner.js    # 平台合规检查（读取 constraints.json）
│   ├── index.js
│   ├── walmart/
│   │   ├── schema.json         # Walmart 字段定义和 CQS 规则
│   │   ├── constraints.json    # 字符限制 / 禁用词（2026版）
│   │   └── attribute_map.json  # 颜色/材质/尺寸 → Walmart 枚举值映射
│   └── wayfair/
│       ├── constraints.json    # Wayfair 规范（三段式/图片/合规）
│       └── class_rules.json    # Class ID 匹配规则（TODO: 从 Partner Home 补全）
│
├── layer5_conversion/
│   └── index.js                # 转化引擎：意图/痛点/钩子/信任信号/消息/策略
│
├── layer6_composer/
│   ├── amazon_composer.js      # Amazon listing 组合
│   ├── walmart_composer.js     # Walmart listing 组合（≤75字符标题/Key Features）
│   ├── wayfair_composer.js     # Wayfair listing 组合（三段式/规格饱和/合规声明）
│   └── index.js
│
├── layer7_solver/
│   └── index.js                # 约束求解器：generate→score→rewrite→re-score→select
│
├── engines/                    # 复用自 Amazon Listing Doctor v1.8
│   ├── keyword_engine.js
│   ├── compliance_engine.js
│   ├── intent_engine.js
│   ├── scoring_engine.js
│   └── image_analyzer.js
│
└── test/
    └── smoke_test.js           # 19项 smoke test（不依赖网络）
```

## 快速开始

```bash
# 诊断模式（兼容现有 Amazon Listing Doctor）
node index.js diagnose B0GJZSK34K

# 生成模式（生成多平台 listing）
node index.js generate B0GJZSK34K --platforms=amazon,walmart,wayfair

# 转写模式（Amazon → Walmart + Wayfair）
node index.js transform B0GJZSK34K --from=amazon --to=walmart,wayfair

# 运行测试
node index.js test
# 或
node test/smoke_test.js
```

## 三种模式

| 模式 | 触发 | 执行层 | 输出 |
|------|------|--------|------|
| `diagnose` | 分析已有 listing | L1→L2→L3→L4→L5(intent/cosmo) | 诊断报告 + 质量分 |
| `generate` | 生成新 listing | L1→L2→L3→L4→L5(full)→L6→L7 | 多平台 listing 文案 |
| `transform` | 跨平台转写 | L1→L2→L3→L4→L5→L6→L7 | 目标平台 listing |

## 数据流

```
scrape → clean → archetype → attributes → competitors → keywords →
pricing → category_match → compliance → intent → cosmo →
pain → hooks → proof → messaging → differentiation → strategy →
compose(amazon/walmart/wayfair) → solve(constraints) → output
```

## 需要人工补充的配置文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `layer4_platform/walmart/attribute_map.json` | ✅ 基础版已就绪 | 补充你产品特有的颜色/材质词 |
| `layer4_platform/wayfair/class_rules.json` | ⚠️ 需补 Class ID | 从 Wayfair Partner Home 确认实际 Class ID |
| `layer4_platform/wayfair/attribute_map.json` | 📋 待创建 | 从 Partner Home 导出 Item Spec Template 后转换 |

## 与 Amazon Listing Doctor v1.8 的关系

- `diagnose` 模式完全向后兼容 v1.8 的输出格式
- `engines/` 目录的所有文件直接从 v1.8 迁移
- v1.8 的 `inject_analysis.js` / `md_to_checkpoints.js` / `report_gen.js` 继续独立使用

## 测试结果

```
19 passed, 0 failed
```

覆盖：context / normalizer / keyword_engine / compliance_engine /
       layer2(archetype) / layer3(keywords+pricing) /
       layer4(category_match) / walmart constraints
