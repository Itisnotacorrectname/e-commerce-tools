# Amazon Listing Doctor v2.6 -mimo 版本说明

**版本日期：** 2026-05-07  
**版本号：** 2.6 -mimo  
**基于：** v2.3 架构 + v2.4 核心优化

---

## 版本对比

| 特性 | v2.3 | v2.4 | v2.6-mimo |
|------|------|------|-----------|
| **架构** | ✅ 清洁（ARCHITECTURE.md） | ❌ 臃肿 | ✅ 清洁 |
| **零依赖** | ✅ 自包含 | ❌ 硬编码 KB 路径 | ✅ 自包含 |
| **coreProduct 提取** | ❌ 未用 category 信号 | ✅ category-weighted | ✅ category-weighted |
| **LLM 降级** | ✅ pattern fallback | ✅ pattern fallback | ✅ pattern fallback |
| **Fact-Check** | ❌ 未实现 | ✅ SKILL.md 定义 | ✅ SKILL.md 定义 |
| **动态 bullet 排序** | ❌ 未实现 | ✅ SKILL.md 定义 | ✅ SKILL.md 定义 |
| **E-GEO 10 维度** | ❌ 未实现 | ✅ SKILL.md 定义 | ✅ SKILL.md 定义 |

---

## v2.6-mimo 核心改进（来自 v2.4）

### 1. category-weighted bigram 打分

**问题：** v2.3 的 bigram 打分只考虑产品类型词，未考虑 category 信号。

**改进：** 给出现在 category 末段的词额外加分（catBoost）。

```javascript
// 例：category 末段 "Dip Stands" → catLastWords = {dip, stand}
// "dip stand" catBoost=2, "bar stand" catBoost=1
// 排序时：dip stand 排在 bar stand 前面

var catBoost = (catLastWords.has(words[i]) ? 1 : 0) + 
               (catLastWords.has(words[i + 1]) ? 1 : 0);
```

### 2. GENERIC_PARENTS 过滤

**问题：** v2.3 会把 "equipment"、"furniture" 等父级分类词当作核心产品词。

**改进：** 过滤通用父级词，避免误判。

```javascript
var GENERIC_PARENTS = new Set([
  'equipment','furniture','products','items','accessories','supplies'
]);
var useParent = prevModifiers.length > 0 && 
                !GENERIC_PARENTS.has(prevModifiers[prevModifiers.length - 1]);
```

### 3. smart fallback（category 与 title 交叉验证）

**问题：** v2.3 会直接使用 category 路径提取的词，即使某些词不在 title 中。

**改进：** 验证 category 提取的词是否真的出现在 title 里。

```javascript
// 例：category 组合 "equipment dip stand" 
//     title 中 "equipment" 不在独立位置 → 过滤
var validatedWords = catCombined.split(/\s+/).filter(function(w) {
  return titleWords.indexOf(w) !== -1;
});
```

### 4. 断裂 bigram 修复

**问题：** v2.3 会生成 "stand dip" 而不是 "dip stand"。

**改进：** 如果倒序后总分更高且两词都在 category 末段，自动 flip。

```javascript
// 例："stand dip" (score=1,catBoost=2) → "dip stand" (倒序后 catBoost不变但顺序正确)
if (reversedTotal > originalTotal && bothWordsInCatLast) {
  b.phrase = reversed;
  b.catBoost = reversedCatBoost;
}
```

---

## 文件结构

```
skills/amazon-listing-doctor-v2.6-mimo/
├── diagnose.js              # 数据层：step1-4 爬虫 + category-weighted coreProduct
├── report_gen.js            # 渲染层：读 checkpoints → 生成 HTML/PDF
├── inject_analysis.js       # JSON 路线：analysis.json → step5-14.json → 报告
├── md_to_checkpoints.js     # md 路线：analysis.md → step5-14.json → 报告
├── SKILL.md                 # 分析层：完整分析逻辑（V1-V18 内联）
├── VERSION.md               # 本文件：版本说明
├── README.md                # 使用说明
├── ARCHITECTURE.md          # 架构设计
├── references/
│   ├── rufus_test.md        # Rufus 意图问题生成模板
│   ├── cosmo_evaluation.md  # Cosmo 0/3/5 评分框架
│   └── violation_rules.md   # V1-V18 完整规则（待创建）
├── knowledge/
│   └── README.md            # 可选用户知识库（skill 本身自包含）
└── lib/
    └── amazon_scraper.js    # Playwright 爬虫核心
```

---

## 使用方式

```bash
# Phase 1: 数据抓取
node skills/amazon-listing-doctor-v2.6-mimo/diagnose.js B09PV32NNK

# Phase 2: Claude 分析（按 SKILL.md 步骤执行）
# Phase 3: 生成报告
node skills/amazon-listing-doctor-v2.6-mimo/report_gen.js B09PV32NNK
```

---

## 开源就绪

✅ **零外部依赖** — skill 自包含所有规则  
✅ **无硬编码路径** — 不依赖 Kane 私人 KB  
✅ **模块化架构** — 可测试、可替换  
✅ **LLM 降级** — pattern fallback 防崩溃  
✅ **不修改源文件** — 全新目录，全新版本  

---

## 待实现（v2.6-mimo 完整版）

- [ ] Fact-Check（G.5）代码实现（diagnose.js step9）
- [ ] 动态 bullet 排序代码实现（diagnose.js step9）
- [ ] violation_rules.md 创建（V1-V18 完整规则）
