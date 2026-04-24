# Amazon Listing Doctor — 技术架构总纲

> 本文档定义技术决策的顶层约束。修改任何 module 前必须对照此文档检查是否偏离。
> 与 CONVENTION.md（工作流程）互为补充：CONVENTION.md = 怎么做，ARCHITECTURE.md = 为什么这样做。

---

## 一、核心设计原则（优先级排序）

### 原则1：LLM + KB + 真实产品数据，优先于硬编码逻辑

所有评分/评估逻辑，必须遵循这个优先级：

```
第1选择：LLM 读取真实 listing 数据 + KB 框架 → 语义级评分
第2选择：Pattern-based KB 规则（无产品词硬编码）→ 模式匹配评分
第3选择：禁止使用硬编码产品词/品类词进行条件判断
```

**禁止的模式**：
```javascript
// ❌ 硬编码产品词
if (isMattress) { /* ... */ }
if (productType === 'sofa') { /* ... */ }

// ❌ 硬编码品类词在评分逻辑里
if (bt.includes('mattress') && something) { score = 5; }

// ❌ 列举式检测（永远无法穷举）
if (bt.includes('BPA-free') || bt.includes('lead-free') || bt.includes('phthalate-free')) {}
```

**允许的模式（有限列举，但用于模式识别，不是产品判断）**：
```javascript
// ✅ 用于识别 E-GEO 维度信号（不针对特定产品）
// Dimension信号检测：容量词、尺寸词
// Safety信号检测：free pattern、grade pattern、certification pattern
// Durability信号检测：material词 + durability词
```

### 原则2：KB 框架是结构，评估是动态的

KB 定义了 E-GEO 的 5 个维度：

| 维度 | 含义 |
|------|------|
| Q1 Use Case | WHO needs this + WHERE it's used |
| Q2 Dimensions | Numeric specs for sizing decisions |
| Q3 Durability | Material + expected longevity |
| Q4 Warranty | Period + coverage |
| Q5 Safety | Material safety + certifications |

这5个维度**固定不变**。但每个维度的评分逻辑应该从 listing 内容推导，而不是预设"床垫要有什么，沙发要有什么"。

### 原则3：数据全部来自 listing 本身

- 不依赖竞品池（竞品池数据会跨类目污染）
- 不依赖静态 KB 里的产品词表
- 所有信号从当前 listing（title + bullets + backend）提取

### 原则4：架构分层，边界清晰

```
┌─────────────────────────────────────────┐
│           diagnose.js (Orchestrator)     │
│  Step1 → Step2 → ... → Step15            │
│  15步机械流程，每步返回checkpoint JSON  │
└─────────────────────────────────────────┘
        ↓ 每步读取依赖的 checkpoint
┌─────────────────────────────────────────┐
│   report_gen.js (Renderer)              │
│  读取所有 checkpoint → 生成 HTML/PDF     │
└─────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────┐
│   amazon_scraper.js (Scraper)            │
│  Playwright 动态抓取，与报告逻辑解耦      │
└─────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────┐
│   kb_rules.js (KB Framework)             │
│  E-GEO 定义 + 规则，不是产品词表          │
└─────────────────────────────────────────┘
```

**每层的职责**：
- `diagnose.js`：流程编排 + 业务逻辑（评分/评估），不直接爬虫
- `report_gen.js`：只读数据，渲染报告，不做评分
- `amazon_scraper.js`：只负责抓取，不做业务判断
- `kb_rules.js`：定义框架（5维度 + 显性/隐性违规规则），不是产品词表

---

## 二、Step 10 评估框架（关键模块）

### 2.1 当前架构（问题）

Step 10 是评分核心模块，曾经历以下阶段：

| 版本 | 架构 | 问题 |
|------|------|------|
| v1 | 固定5问题文本 + regex评分 | 问题文本硬编码（mattress/sofa） |
| v2 | productType if-else 分支 | 永远有新产品类型覆盖不到 |
| v3 | attribute-driven + if-else | 依然有产品类型判断逻辑 |
| **v4** | **LLM + KB混合** | **当前：LLM优先，fallback到pattern** |

### 2.2 正确架构（Target）

```
输入：title + bullets + kb (5维框架)

┌─ LLM 调用成功？ ─┐
│      是          │→ LLM 语义级评分（JSON格式输出）
│      否          │→ KB pattern-based fallback
└─────────────────┘
        ↓
输出：{ scores[], averageScore, reason, suggestions }
```

**LLM Prompt 设计原则**：
- 告诉 LLM：具体产品标题 + bullets 内容（真实数据）
- 告诉 LLM：KB 的 5 个维度是什么（框架）
- 让 LLM：根据 listing 实际内容，对每个维度评分
- LLM 输出：分数 + 具体理由（引用 listing 内容）+ 改进建议

**禁止**：在 prompt 里写"如果是床垫，要检查 CertiPUR-US"这类产品词规则。

### 2.3 KB Pattern Fallback 规范

当 LLM 不可用时，fallback 逻辑必须遵守：

```javascript
// ✅ 正确：维度信号检测，不是产品词检测
var signals = {
  safety: /BPA.?free|lead.?free|phthalate.?free|non.?toxic|food.?grade|certified/i.test(bt)
};
// ❌ 错误：列举式产品词检测
var isMattress = /mattress|foam/i.test(bt);

// ✅ 正确：模式匹配
var hasMaterialClaim = /(stainless|steel|glass|ceramic|fabric|leather)/i.test(bt);
// ❌ 错误：hardcoded 产品词
var hasMattressMaterial = /memory.?foam|high.?density/i.test(bt);
```

---

## 三、各模块设计约束

### 3.1 Step 1-9（数据抓取 + 预处理）

**允许**：检测属性信号（`hasDims`, `hasMaterial`, `hasWarranty`）用于业务逻辑分流。  
**禁止**：检测产品类型（`isMattress`, `isSofa`, `productType`）做业务逻辑分流。

```javascript
// ✅ OK: 属性信号用于评分维度检测
var hasCert = /ETL|UL|CE|FDA/i.test(bt);

// ❌ NO: 产品类型用于评分分支
if (isMattress) { /* specific mattress rules */ }
```

### 3.2 Step 10（Rufus评分）

- **必须**：先尝试 LLM
- **必须**：LLM 失败时走 KB pattern fallback
- **禁止**：在 fallback 里写产品类型分支（`if (isMattress)` 等）
- **禁止**：在 prompt 里根据产品类型定制问题文本

### 3.3 Step 11（显性违规）

- V1-V8 规则固定，不可改
- 每个违规的 matched 词必须精确

### 3.4 Step 12（隐性违规 + E-GEO）

- E-GEO 的 5 个维度（Q1-Q5）是 KB 框架，不可以增删
- 缺失判断基于 listing 内容是否正面回答了维度问题

### 3.5 Step 9（Bullet优化）

- `→ 建议` 格式是行动导向，不带 `[FIX]`/`[ENHANCE]` 标签
- 建议内容基于具体缺失特征，不使用硬编码示例（如 "stainless steel housing"）

---

## 四、LLM 接入规范

### 4.1 接入方式

通过 OpenClaw Gateway 接入 LLM：

```javascript
// 通过 OpenClaw session 调用 LLM（推荐方式）
// 让 OpenClaw 负责 routing、auth、rate limit

// 或者直接 HTTP 到 Gateway
http.request({ hostname: '127.0.0.1', port: 18789, path: '/v1/chat/completions', ... })
```

### 4.2 LLM Prompt 模板

```
SYSTEM: You are a precise Amazon listing analyst. Output ONLY valid JSON array.
USER: [title]\n[bullets]\n\nEvaluate on 5 E-GEO dimensions...
```

### 4.3 LLM 输出格式

```json
[
  {"questionId": "Q1", "category": "Use Case", "score": 4, "reason": "...", "suggestions": ["..."]},
  {"questionId": "Q2", ...},
  ...
]
```

---

## 五、何时需要重构 ARCHITECTURE.md

满足以下任一条件时，需要更新本文档：

1. 新增/删除 Step
2. 改变 Step 之间的依赖关系
3. 引入新的数据源（不再 self-only）
4. 更换 LLM Provider
5. E-GEO 框架维度变化（Q1-Q5 以外新增/删除）
6. 发现架构约束与实现代码不一致（架构漂移）

---

*本文档定义了 Amazon Listing Doctor 的技术边界。任何修改如果违反上述约束，必须先更新本文档再实施修改。*