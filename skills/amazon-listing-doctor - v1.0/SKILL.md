---
name: Amazon Listing Doctor
slug: amazon-listing-doctor
version: 5.0.0
description: Diagnose any Amazon listing with a full competitive audit, Rufus intent simulation, Cosmo content scoring, and rewritten bullet copy. Paste any amazon.com product link to run.
---

## 触发条件

以下任一情形触发本 skill：

- 用户粘贴 `amazon.com/dp/` 或 `amazon.com/gp/product/` 链接
- 用户说"诊断这个listing"、"分析这个亚马逊链接"、"diagnose this listing"、"audit this Amazon product"

---

## 架构概述

本 skill 采用**路线 B：Claude Agent 辅助执行**架构。三层职责严格分离：

```
层1 数据层（脚本）   diagnose.js step1-4  →  data_package.json
层2 分析层（Claude） 本 SKILL.md 定义全部分析逻辑  →  analysis 结论
层3 渲染层（脚本）   report_gen.js  →  HTML 报告
```

**核心原则：脚本只爬虫，Claude 只分析，report_gen 只渲染。**

---

## 文件结构

```
skills/amazon-listing-doctor/
├── diagnose.js              # 数据层：step1-4 爬虫，输出 data_package.json
├── report_gen.js            # 渲染层：读 checkpoints → 生成 HTML/PDF
├── SKILL.md                 # 本文件：Claude 分析框架（完整内化，不依赖外部 kb）
├── references/
│   ├── rufus_test.md        # Rufus 意图问题生成模板
│   └── cosmo_evaluation.md  # Cosmo 0/3/5 评分框架
└── lib/
    └── amazon_scraper.js    # Playwright 爬虫核心

workspace/amazon-listing-doctor/   ← 用户数据，不随 skill 升级删除
├── checkpoints/[ASIN]/            # 每步 JSON checkpoint
└── reports/[ASIN]/                # HTML/PDF 报告
```

---

## 数据源规则（Critical）

| 数据类型 | 来源 | 是否允许 |
|---------|------|---------|
| 目标 listing（title/price/bullets/rating） | diagnose.js 实时抓取 | ✅ 必须 |
| 竞品数据（title/price/rating） | diagnose.js 实时抓取 | ✅ 必须 |
| 关键词 | 竞品标题词频分析 | ✅ 必须 |
| 分析框架和优化规则 | 本 SKILL.md 内置 | ✅ 是 |
| Claude 训练知识推断的竞品/价格/关键词 | — | ❌ 绝对禁止 |

**若竞品抓取失败：** 明确告知用户"竞品数据未能获取，以下分析基于优化原则而非实测数据"，绝不虚构竞品标题、价格或排名。

---

## 执行流程

### Phase 1：调用数据层脚本

```bash
node diagnose.js [ASIN 或 Amazon URL]
```

脚本完成后在 `workspace/amazon-listing-doctor/checkpoints/[ASIN]/` 生成：

- `step1.json` — ASIN、marketplace、domain
- `step2.json` — title、bullets、price、rating、reviewCount、BSR、category、brand
- `step3.json` — primaryKeyword、coreProduct、sizeSignals
- `step4.json` — competitors[]（含 asin、title、price、rating）、cascadeRounds、totalFound

读取这四个文件作为后续所有分析的唯一数据来源。

---

### Phase 2：Claude 执行分析（按顺序，不跳步）

---

#### A. 关键词分级（Keyword Universe）

**数据来源：** step4.json 的竞品标题列表

**方法：**
1. 对所有竞品标题做词频统计（去除品牌词、stopwords、单字母词）
2. 按出现频率分三级：
   - **Primary**（出现在 ≥40% 竞品标题中）：买家搜索的核心词，title 必须包含
   - **Secondary**（出现在 20-39% 竞品标题中）：差异化词，title 或 bullet 包含
   - **Backend**（出现在 10-19% 竞品标题中，或 target listing 自身有但竞品少有）：长尾词，放 backend keywords
3. 额外提取：竞品标题中出现的容量/尺寸规格词（`2QT`、`12 inch`、`1.5L` 等）单独列出作为 Size Signals

**若竞品数量 < 5：** 降级使用 target listing 自身标题的 bigram，但必须在报告中注明"竞品数据不足，关键词分析仅供参考"。

---

#### B. 标题审计（Title Audit）

**数据来源：** step2.json（目标标题）+ step4.json（竞品标题）+ A 步骤的 Primary 关键词

**检查项：**

| 检查 | 规则 | 严重度 |
|------|------|--------|
| 字符数 | >200 chars → 超限 | 🔴 Critical |
| 拼写错误 | 扫描标题每个词，检查明显拼写错误 | 🔴 Critical |
| Primary 关键词缺失 | 核心词不在标题最左侧位置 | 🔴 High |
| 品牌词后置 | 品牌不在标题开头（如适用） | 🟡 Medium |
| 竞品普遍有但本品缺失的词 | 对比 Primary 词列表 | 🟡 Medium |
| 无数字规格 | 容量/尺寸/重量不在标题中 | 🟡 Medium |
| Pipe 数量 > 2 | 影响可读性 | 🟡 Medium |
| 促销词 | "Best"、"#1"、"Sale"、"Limited" | 🔴 High |

**输出格式：**
```
[严重度] 问题描述
  现状："[原文片段]"
  建议：[具体修改方向]
```

---

#### C. 三版优化标题

**数据来源：** A 步骤关键词 + B 步骤审计结论 + step2.json 产品规格

**结构原则（NPO — Noun Phrase Optimization）：**
每个逗号分隔的段落代表一个完整的语义节点，COSMO 可以独立解析。

```
[Brand] [Core Product Type] [Size/Capacity], [Key Material/Technology], [Primary Use Case/Benefit], [Secondary Feature], [Target Customer]
```

**三版定位：**
- **Version A — 最大关键词覆盖：** 包含所有 Primary + 关键 Secondary 词，适合关键词覆盖优先
- **Version B — 高 CTR：** 更口语化，突出最强差异点，适合转化率优先
- **Version C — 移动端优化：** ≤80 chars，只保留最核心词组，适合移动端首屏显示

**每版输出：**
- 标题文本
- 字符数
- 覆盖的 Primary 关键词列表
- 对齐的竞品标题模式说明

---

#### D. Backend Keywords

**数据来源：** A 步骤三级关键词 + 竞品标题中未出现在目标标题的词

**规则：**
- 只放 target listing 标题和 bullets 中**未出现**的词（避免重复占用）
- 包含：同义词、使用场景词、目标用户词、常见错别字、替代度量单位
- 不包含：竞品品牌词、促销词、已在标题中的词
- 目标：填满 250 bytes，空格分隔，全小写，无逗号

---

#### E. Rufus 意图模拟（Rufus Intent Simulation）

**框架来源：** `references/rufus_test.md`

**执行方式：** 使用以下 prompt 模板，填入真实产品数据后，以 Rufus 身份生成问题：

```
You are Amazon Rufus, a generative AI shopping assistant.
A customer is browsing in the [CATEGORY] category with a primary interest in: [PRIMARY KEYWORD from Step A].

Based on this product context:
- Product: [title from step2.json]
- Category: [category from step2.json]
- Key specs: [size signals + key specs from step2.json bullets]

Generate exactly 3 deep consumer intent questions Rufus would ask this customer.

Requirements:
- Questions must reflect USE-CASE scenarios, PAIN POINTS, or MATERIAL/FEATURE COMPARISONS
- Do NOT ask: price, shipping time, warranty coverage, or return policy questions
- Frame questions as a knowledgeable in-store sales associate — specific, scenario-driven
- Questions should be answerable by a well-optimized product listing

Format: plain numbered list, no preamble.
```

**关键：** 这3个问题代表 COSMO Knowledge Graph 中，买家搜索该品类时最常被触发的 **intent nodes**。listing 对这些问题的回答能力，直接决定 Rufus 会不会推荐这个产品。

---

#### F. Cosmo 内容评分（Cosmo Scoring）

**框架来源：** `references/cosmo_evaluation.md`

**输入：** E 步骤生成的 3 个 Rufus 问题 + step2.json 的 5 条 bullets

**对每个问题执行：**

1. 通读全部 5 条 bullets
2. 按以下 rubric 打分：

| 分数 | 标签 | 标准 |
|------|------|------|
| **5** | Directly Addresses | Bullet 明确提及与问题相关的属性或场景，买家无需推断 |
| **3** | Implicitly Addresses | Bullet 涉及相关话题但表述不直接，买家需要自行关联 |
| **0** | Missing | Bullet 完全未涉及该问题，持有此需求的买家得不到任何信号 |

3. 引用具体 bullet 文本作为评分依据

4. **凡分数 ≤ 3，必须输出 Intent Enhancement：**
   写一段自然语言改写建议，展示如何将该 bullet 改写到得 5 分。
   - 以 benefit 开头，明确说明属性，用具体场景锚定
   - 不堆砌关键词，语言自然
   - 指明应修改哪条 bullet 或是否需要新增

**输出格式：**
```
Q[N]: [Rufus 问题原文]
Score: [5 | 3 | 0] — [标签]

Matching bullets:
- Bullet [#]: "[引用原文]" → [如何回答或为何无法回答该问题]

[若 score ≤ 3]
Intent Enhancement:
"[改写后的 bullet 文本]"
（说明：这段改写如何直接回答了问题，会得 5 分的原因）
```

**整体解读：**
- 3 题全 5 分 → listing 语义覆盖强，Rufus 会自信推荐
- 任一题 0 分 → P0 修复项，对应该意图的买家对你的 listing 完全不可见
- 全部 ≤ 3 分 → 系统性语义缺失，不是缺个别关键词，而是整个产品维度没有表达清楚

---

#### G. Bullet 完整改写方案

**数据来源：** step2.json 的原始 bullets + F 步骤的 Intent Enhancement 建议 + A 步骤关键词

**改写原则（Feature + Benefit + Specificity）：**

每条 bullet 必须包含三个要素：

| 要素 | 含义 | 示例 |
|------|------|------|
| Feature | 具体功能或材料（避免模糊形容词） | "Tri-ply stainless steel construction" |
| Benefit | 对买家的实际价值 | "delivers even heat distribution, no hot spots" |
| Specificity | 量化或高度具体的细节 | "compatible with all cooktops including induction" |

❌ 弱：`Premium non-stick coating for easy cooking`
✅ 强：`Honeycomb Non-Stick Interior — food releases cleanly without oil; PFAS-free and food-grade safe for healthy everyday cooking`

**Bullet 优先级顺序（参考竞品高频模式）：**
1. 首条：最强差异点或核心技术
2. 第二条：目标使用场景 + 解决的具体问题
3. 第三条：关键材料规格（含认证）
4. 第四条：兼容性 / 使用便利性
5. 第五条：保修 / 售后承诺

**为每条 bullet 输出：**
- 原文（完整引用）
- 改写版本
- 改写说明（改了什么，为什么）

---

#### H. 显性违规检测（Explicit Violations V1-V8）

**扫描范围：** title + 全部 bullets

逐条对照以下规则，命中则引用原文并说明违规类型：

| ID | 违规类型 | 检测模式 |
|----|---------|---------|
| V1 | 无依据最高级 | `#1`、`Best Ever`、`Top Rated`、`#1 Rated`（未经独立验证） |
| V2 | 直接贬低竞品 | `vs`、`better than`、`unlike` + 竞品名 |
| V3 | 未经证实的健康声明 | `clinically proven`、`FDA approved`（非医疗器械品类） |
| V4 | 促销性价格语言 | `free shipping`、`best price`、`deal`、`limited time` |
| V5 | 虚假稀缺性 | `only X left`、`running out`、`high demand` |
| V6 | 误导性认证 | 提及 CertiPUR-US / OEKO-TEX 等认证但无具体认证编号或来源说明 |
| V7 | 超出字符限制 | Title > 200 chars / 任一 Bullet > 500 chars |
| V8 | 保修信息矛盾 | 同时出现"无保修"和具体保修期限 |

**E-GEO 关联：** 任何事实性违规（V1/V3/V6）直接触发 COSMO 的 "Maintains Factuality" 负向信号，导致 Rufus 排名下降。

---

#### I. 隐性违规检测（Implicit Violations V9-V18）

**扫描范围：** title + bullets + step4.json 竞品对比

**E-GEO 10 特征缺失检测：**

| ID | 特征 | 缺失判断标准 |
|----|------|------------|
| V9 | Ranking Emphasis | 核心关键词不在标题最左位置，或标题开头是品牌名而非品类词（视品类而定） |
| V10 | User Intent 覆盖 | E 步骤的 Rufus 问题在 bullets 和 Q&A 中均无答案（p15 pre-emptive answering 缺失） |
| V11 | Competitiveness | Bullets 只有属性堆砌，无任何差异化说明（"unlike"禁用，但正向差异化要有） |
| V12 | Social Proof 缺失 | 评分 ≥ 4.5 且评论数 ≥ 50，但 bullets 无任何评价引用或 bestseller 信号 |
| V13 | Compelling Narrative 缺失 | Bullets 全由规格构成，无任何使用场景或用户视角描述 |
| V14 | Authoritativeness 缺失 | 无认证、无测试数据、无具体技术参数（只有模糊形容词） |
| V15 | Unique Selling Points 缺失 | 与竞品标题高度雷同，无任何独特卖点 |
| V16 | Urgent Call 缺失 | 无任何使用时机、礼物场景、季节性或使用场合暗示 |
| V17 | Easily Scannable 差 | 任一 bullet 超过 3 句连续长句且无换行、无数字标记、无结构化断点 |
| V18 | Factuality Violation | 多个未验证 superlative 同时叠加（`best` + `easiest` + `most durable` 同时出现） |

**p15 Q&A 信号（需说明，无法从 listing 文本直接验证）：**
提示用户检查：产品页 Q&A 区是否有回答 E 步骤 Rufus 问题的内容；无 Q&A 或长期未回复的问题是 Rufus RAG 信号空洞。

---

#### J. Listing Weight 评估

**数据来源：** step2.json + step4.json 竞品均价/均分

评估以下因素，每项给出现状和具体行动建议：

| 因素 | 评估方法 | 输出 |
|------|---------|------|
| 评论数 | 与竞品均值对比 | 差距 + 建议（Vine、促评策略） |
| 评分 | 与竞品均分对比 | 若 < 4.0 需说明潜在问题方向 |
| 价格定位 | 与竞品均价对比 | 若 > 均价 20% 建议说明差异化或加 coupon |
| 主图 | 无法从爬虫获取 | 注明"需人工检查：主图是否有白底、是否包含功能文字标注" |
| 视频 | 无法从爬虫获取 | 注明"需人工确认：是否有产品演示视频" |
| A+ 内容 | 无法从爬虫获取 | 注明"需人工确认：是否有 A+ 内容，是否含对比图表" |
| BSR | step2.json 的 BSR 数据 | 当前排名 + 与目标差距分析 |

---

#### K. 优先行动计划（Priority Action Plan）

汇总所有步骤的发现，按优先级排列：

| 优先级 | 触发条件 | 说明 |
|--------|---------|------|
| **P0** | 显性违规（V1-V8）任一命中 | 必须立即修复，有下架/流量损失风险 |
| **P1** | Cosmo 评分任一题为 0 分 | 对应意图的买家完全看不到你，直接影响转化 |
| **P1** | Primary 关键词缺失 | 搜索可见性根本问题 |
| **P2** | Cosmo 评分有题为 3 分 | 可见但不够有力，优化空间明确 |
| **P2** | 隐性违规（V9-V18）命中 | 间接影响 Rufus 推荐权重 |
| **P3** | Backend keywords 不完整 | 长尾流量损失 |
| **P3** | Listing Weight 因素（评论/视频/A+） | 运营层面的综合优化 |

每条行动项格式：
```
[P0/P1/P2/P3] [具体行动] → [位置：Title/Bullet N/Backend] → [预期影响]
```

---

#### L. 数据完整性声明（Data Integrity）

在报告末尾必须输出，不可省略：

```
⚠ 数据说明：
- 目标 listing 数据：实时抓取（[抓取时间]）
- 竞品数据：[实时抓取 N 条 | 抓取失败，以下分析基于优化原则]
- 价格数据：[正常 | 疑似 geo-redirect，价格仅供参考]
- 以下内容无法通过爬虫获取，需人工确认：主图质量、视频、A+ 内容、Q&A 详情
- 本报告不包含任何虚构数据
```

---

## 输出格式

### 对话中输出

按以下结构输出分析结论（markdown 格式）：

```
## Amazon Listing Doctor — [ASIN]
[品牌] | [品类] | 评分 [X]/5 · [N] 条评论 | 价格 $[X]

---
### 1. 关键词分级
...

### 2. 标题审计
...

### 3. 三版优化标题
...

### 4. Backend Keywords
...

### 5. Rufus 意图模拟
...

### 6. Cosmo 评分
...

### 7. Bullet 完整改写
...

### 8. 显性违规
...

### 9. 隐性违规
...

### 10. Listing Weight
...

### 11. 优先行动计划
...

---
⚠ 数据说明
...
```

### HTML 报告生成

分析完成后调用：

```bash
node report_gen.js [ASIN]
```

report_gen.js 读取 checkpoints 目录下的所有 JSON 文件生成完整 HTML 报告，路径：
`workspace/amazon-listing-doctor/reports/[ASIN]/[ASIN].html`

### Checkpoint JSON Schema（step5-14）

⚠️ **report_gen.js 依赖以下字段名，必须严格匹配。**

#### step5.json — 关键词分级
```json
{
  "primary": [
    { "keyword": "dining table set", "freq": "31/31 (100%)", "note": "core category term" }
  ],
  "secondary": [
    { "keyword": "modern", "freq": "14/31 (45%)", "note": "style positioning" }
  ],
  "backend": [
    "modern dining table set",
    "kitchen table chairs set of 6"
  ]
}
```
- `primary` / `secondary`: 数组，对象含 `keyword`, `freq`, `note`
- `backend`: **字符串数组**（不是逗号分隔字符串）

#### step6.json — 标题审计
```json
{
  "issues": [
    { "severity": "medium", "issue": "Metal Steel redundancy", "detail": "Steel IS metal — wastes 6 chars" }
  ],
  "spellErrors": [
    { "word": "outdoorgrade", "suggestion": "outdoor-grade", "context": "Bullet 3" }
  ],
  "charCount": 159,
  "charLimit": 200,
  "brandAtStart": true
}
```
- `issues[].issue`: 问题标题（表格第一列）
- `issues[].detail`: 详细说明（表格第三列）
- `issues[].severity`: `critical` / `high` / `medium` / `low`
- `spellErrors`: 拼写错误数组，可为空

#### step7.json — 三版优化标题
```json
{
  "versionA": "PHI VILLA 7 Piece Outdoor Dining Set for 6...",
  "versionAChars": 162,
  "versionANote": "Maximum keyword coverage",
  "versionB": "PHI VILLA 7-Piece Metal Outdoor Dining Set...",
  "versionBChars": 148,
  "versionBNote": "High CTR",
  "versionC": "PHI VILLA 7-Piece Metal Outdoor Dining Set...",
  "versionCChars": 75,
  "versionCNote": "Mobile-first"
}
```
- `versionA` / `versionB` / `versionC`: **纯字符串**（不是对象）
- `versionAChars` / `versionBChars` / `versionCChars`: 数字
- `versionANote` / `versionBNote` / `versionCNote`: 说明文字

#### step8.json — Backend Keywords
```json
{
  "backend": "modern dining table set kitchen table chairs set of 6 ...",
  "charCount": 240,
  "charLimit": 250
}
```
- `backend`: **单个字符串**，空格分隔，全小写
- `charCount`: 字节数

#### step9.json — Bullet 改写
```json
{
  "bullets": [
    {
      "original": "Large Metal Dining Table: ...",
      "rewrite": "Large Metal Dining Table: 60\"L x 38\"W ...",
      "explain": "Added exact dimensions upfront"
    }
  ]
}
```
- `bullets[].original`: 原文
- `bullets[].rewrite`: 改写版本
- `bullets[].explain`: 改写说明

#### step10.json — Rufus 意图问题
```json
{
  "questions": [
    "I need a dining set that can stay outside year-round...",
    "We have a family of 6 and host outdoor dinners often..."
  ]
}
```
- `questions`: **字符串数组**（3 个问题）

#### step11.json — Cosmo 评分
```json
{
  "scores": [
    {
      "question": "I need a dining set that can stay outside...",
      "score": 5,
      "label": "Directly Addresses",
      "evidence": "Bullet 1: 'ecoating processed strong steel...'"
    },
    {
      "question": "We have a family of 6...",
      "score": 3,
      "label": "Implicitly Addresses",
      "evidence": "Bullet 2: 'support 300 lbs'...",
      "enhancement": "Stackable Metal Chairs (Set of 6): 25.2\"D..."
    }
  ],
  "averageScore": 4.3
}
```
- `scores[].question`: Rufus 问题原文
- `scores[].score`: 5 / 3 / 0
- `scores[].label`: `Directly Addresses` / `Implicitly Addresses` / `Missing`
- `scores[].evidence`: 引用 bullet 文本
- `scores[].enhancement`: 仅 score ≤ 3 时需要，否则为 null 或省略
- `averageScore`: 数字（所有 score 的平均值）

#### step12.json — 违规检测
```json
{
  "violations": [
    { "id": "V1", "severity": "high", "type": "无依据最高级", "description": "...", "fix": "..." }
  ],
  "implicit": [
    { "id": "V10", "severity": "medium", "type": "User Intent Coverage", "description": "...", "fix": "..." }
  ]
}
```
- `violations`: 显性违规数组（V1-V8），可为空
- `implicit`: 隐性违规数组（V9-V18），可为空

#### step13.json — Listing Weight
```json
{
  "issues": [
    { "factor": "Reviews", "current": "24", "status": "low", "note": "Far below typical 200+" },
    { "factor": "Rating", "current": "3.9", "status": "below_4", "note": "Below 4.0 threshold" },
    { "factor": "Main Image", "current": "N/A", "status": "needs_check", "note": "Cannot scrape" }
  ],
  "summary": "24 reviews (low), 3.9 rating (below 4.0)"
}
```
- `issues[].factor`: 评估因素名
- `issues[].current`: 当前值
- `issues[].status`: `ok` / `low` / `below_4` / `above_avg` / `needs_check`
- `issues[].note`: 说明

#### step14.json — 行动计划
```json
{
  "qualityScore": 82,
  "qualityGrade": "B+",
  "plan": [
    { "priority": "P1", "action": "Fix Bullet 2: add seat dimensions", "location": "Bullet 2", "impact": "Cosmo Q2 3→5" },
    { "priority": "P2", "action": "Remove 'Steel' from title", "location": "Title", "impact": "Save 6 chars" }
  ]
}
```
- `qualityScore`: 数字（0-100）
- `qualityGrade`: 字母等级（A+ / A / B+ / B / C / D / F）
- `plan[]`: 行动项数组，每项含 `priority`（P0/P1/P2/P3）、`action`、`location`、`impact`

#### 评分公式
```
qualityScore = title(20) + bullets(25) + cosmo(15) + backend(10) + violations(10) + weight(15) + usp(5)
```
| 维度 | 满分 | 评分依据 |
|------|------|----------|
| Title | 20 | 关键词覆盖 + 字符数 + 无拼写错误 |
| Bullets | 25 | Feature+Benefit+Specificity 完整度 |
| Cosmo | 15 | 3题平均分 × 3 |
| Backend | 10 | 250 bytes 填充率 + 去重 |
| Violations | 10 | 0 显性 = 满分，每命中 -3 |
| Weight | 15 | 评论数/评分/价格定位 |
| USP | 5 | 差异化卖点明确度 |

---

## 核心知识框架（内置，不依赖外部 kb 文件）

### COSMO 知识图谱原理

COSMO（Common Sense Knowledge Generation）是 Amazon 的语义搜索算法。它不做关键词匹配，而是构建**知识图谱**：

- **节点（Nodes）：** 产品、特性、使用场景、用户群体
- **边（Edges）：** 关系，如 "treats"（床垫 treats 腰痛）、"suitable_for"（适合侧卧者）

**对卖家的核心含义：** 你不是在排名某个关键词，而是在争夺知识图谱中的一个节点，并确保这个节点连接到正确的 intent 节点。listing 内容越具体、越场景化，COSMO 建立连接的信心就越高。

### Rufus RAG 机制

Rufus 采用 RAG（检索增强生成）架构：
1. **检索阶段：** 从 Amazon 产品目录、评论、Q&A 中检索相关信息
2. **生成阶段：** 合成自然语言回答并对产品进行**重排序**

**关键洞察：** 被检索到是必要条件但不充分——Rufus 的生成层会根据与用户意图的匹配度重新排序。listing 内容不仅要包含正确的词，还要**在买家提问之前提供答案**（pre-emptive answering）。

### GEO 优化原则（E-GEO 研究结论）

基于 Bagga et al. (2025) E-GEO benchmark（7000+ Reddit 真实购物查询 + Amazon listing 评测）：

**有效的策略（按效果排序）：**
1. **具体性（Grounded Specificity）：** 具体产品事实 > 营销语言，数字和可验证细节得分高
2. **意图匹配语言（Intent-Matching Language）：** 用买家实际使用的词，不是卖家视角的词
3. **结构化完整性（Structured Completeness）：** 在描述中直接回答买家可能提出的子问题
4. **权威引用（Authoritative Citations）：** 数字、认证、可验证事实是 LLM 信任信号

**核心结论：** 在买家提问之前就提供答案的 listing，被生成式引擎引用的排名更高。这直接对应 Cosmo 评分中"Directly Addresses = 5分"的评判标准。

### Bullet 写作框架

每条 bullet 必须回答三个问题：

1. **What** — 这个功能/材料具体是什么？（Feature，要具体，不要模糊形容词）
2. **So what** — 对买家意味着什么？（Benefit，从买家视角出发）
3. **How much / How specifically** — 能量化或高度具体化吗？（Specificity，数字或场景）

这三个要素对应 COSMO 知识图谱中的三类节点：属性节点、价值节点、使用场景节点。三者同时存在，COSMO 才能建立完整的产品-意图连接。

---

## 注意事项

1. **分析顺序不可打乱：** A（关键词）→ E（Rufus问题）→ F（Cosmo评分）有严格的数据依赖，必须按顺序执行
2. **数据来源透明：** 每项结论都应能追溯到具体的 checkpoint 数据，禁止用训练知识补充缺失数据
3. **竞品数量影响置信度：** 竞品 < 5 条时所有基于竞品的分析都要标注置信度低
4. **中英文混用规则：** 报告中文分析为主，专业术语（COSMO、Rufus、E-GEO、NPO）保留英文；向用户解释时自动判断用户语言偏好
5. **Cosmo 评分的 Intent Enhancement 不可省略：** 这是报告中最有直接使用价值的内容，不写改写文案等于没做分析
