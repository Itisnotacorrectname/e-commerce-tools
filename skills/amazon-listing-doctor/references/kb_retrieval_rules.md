# Knowledge Base Retrieval Rules — Listing Doctor

## Principle

诊断过程中，按Step和Product Category动态调取知识库。知识库是**外挂在用户私人目录**，不是skill内置文件。

## Knowledge Base Location

**Skill内路径：** `C:/Users/csbd/.openclaw/workspace/skills/amazon-listing-doctor/knowledge/`

> ⚠️ 知识库文件需用户自行补充。详见 `knowledge/README.md`。

## Retrieval Triggers by Step

### Step 3 — Keyword Research
**触发条件：** 无特定条件，常规执行
**调取文件：**
- `rufus_links/02_sellerlabs_rufus_optimization.md` — Amazon搜索词如何影响 Rufus 理解
- `rufus_links/10_adspert_ppc_guide.md` §关键词研究部分
**用途：** 理解Amazon搜索算法如何处理关键词，确保关键词池覆盖 Rufus 的语义理解维度

---

### Step 6 — Title Audit
**触发条件：** 无特定条件，常规执行
**调取文件：**
- `rufus_links/02_sellerlabs_rufus_optimization.md` — 标题与算法理解
- `rufus_links/03_amazon_science_rufus.md` — Amazon官方Rufus技术解读（标题相关性）
**用途：** 判断标题是否被Rufus正确索引和理解

---

### Step 10 — Rufus Intent Test
**触发条件：** 常规执行（所有产品）
**调取文件（必须）：**
- `workflow.md` 中的 Step 10 部分 — 提示词模板
- `references/rufus_test.md` — Step 10详细Procedure
**补充文件（按category选读）：**
- `rufus_links/03_amazon_science_rufus.md` — Rufus的语义理解机制
- `rufus_links/06_prebodi_convergence.md` — Cosmo+Rufus+A10协同机制
**用途：** 生成真正能揭示语义漏洞的用户意图问题

---

### Step 11 — Cosmo Scoring
**触发条件：** 常规执行（所有产品）
**调取文件（必须）：**
- `references/cosmo_evaluation.md` — Step 11评分Rubric
**补充文件：**
- `rufus_links/06_prebodi_convergence.md` — Cosmo内容评分逻辑
- `2511.20867v1.kb.txt` §E-GEO特征 — "Easily Scannable" / "Maintains Factuality"评分维度
**用途：** 评估Bullet是否明确映射到用户意图

---

### Step 12 — 显性违规识别
**触发条件：** 常规执行（所有产品）
**调取文件：**
- `listing显性违规识别知识库.txt` — V1-V8完整规则（Kane私人KB）
**用途：** 检测标题/Bullet中的违规表述

---

### Step 13 — 隐性违规识别
**触发条件：** 常规执行（所有产品）
**调取文件：**
- `listing隐性违规识别知识库.txt` — V9-V16完整规则（Kane私人KB）
- `2511.20867v1.kb.txt` §E-GEO特征矩阵 — V16 E-GEO特征冲突检测
- `p15.kb.txt` — Q&A信号空洞检测（V10）
**用途：** 检测"买前不答"、E-GEO特征缺失等隐性违规

---

### Step 15 — Priority Action Plan
**触发条件：** 当P0/P1优先级action需要优化依据时
**调取文件：**
- `rufus_links/04_zonguru_what_is_cosmo.md` ⛔ 暂未抓取
- `rufus_links/05_zonguru_optimize_rufus.md` ⛔ 暂未抓取
- `2511.20867v1.kb.txt` §14 — E-GEO rewriting策略
- `p15.kb.txt` §pre-emptive answering — 产品描述应先于用户提问回答
**用途：** 将E-GEO优化策略转化为具体可执行Action

---

## Product Category — Special Handling

### 高教育属性产品（Books, Electronics, Educational toys, Training equipment）
**额外调取：**
- `rufus_links/07_aisel_amcis2025_152.pdf` — 学术论文：Amazon算法在学术产品品类行为
- `rufus_links/08_sellermetrics_rufus.md` — Rufus对学习型产品的意图理解
**原因：** 这类产品用户意图更复杂，Rufus的语义理解权重更高

### 时尚/外观驱动产品（Clothing, Accessories, Home decor）
**额外调取：**
- `rufus_links/06_prebodi_convergence.md` §Cosmo — Cosmo对视觉内容的处理
**原因：** Cosmo（和A10）在时尚品类更多依赖视觉信号而非文本

### 健康/安全敏感产品（Mattress, Baby products, Beauty, Health）
**额外调取：**
- `listing显性违规识别知识库.txt` §健康声明 — V3未经证实健康声明规则
- `listing隐性违规识别知识库.txt` §V12权威性缺失
**原因：** 这些品类违规风险更高，需要更严格检查

---

## KB Article Quick Reference

| 文件 | 主要内容 | 关键用途 |
|------|---------|---------|
| `knowledge/rufus_links/02_sellerlabs_rufus_optimization.md` | Rufus搜索优化实操 | Step3/6/10背景 |
| `knowledge/rufus_links/03_amazon_science_rufus.md` | Amazon官方Rufus技术原理 | Step10/11背景 |
| `knowledge/rufus_links/06_prebodi_convergence.md` | Cosmo+Rufus+A10三合一 | Step11/13背景 |
| `knowledge/rufus_links/07_aisel_amcis2025_152.md` | 学术品类算法研究 | 高教品类Step10 |
| `knowledge/research/2511.20867v1.kb.txt` | E-GEO benchmark论文 | Step13 V16 |
| `knowledge/research/p15.kb.txt` | Q&A推荐系统 | Step13 V9/V10 |
| `knowledge/violations/listing显性违规识别知识库.txt` | V1-V8违规规则 | Step12 |
| `knowledge/violations/listing隐性违规识别知识库.txt` | V9-V16违规规则 | Step13 |

---

## Implementation Note

在diagnose.js的每个Step函数中，添加KB调取逻辑：

```javascript
var SKILL_KB = __dirname + '/../knowledge/';

// Step 10: Rufus Intent Test
const rufusKb = {
  mustRead: [
    __dirname + '/rufus_test.md',
    fs.readFileSync(SKILL_KB + 'rufus_links/03_amazon_science_rufus.md', 'utf8')
  ],
  categoryRead: {
    'Books': [SKILL_KB + 'rufus_links/07_aisel_amcis2025_152.md'],
    'Electronics': [SKILL_KB + 'rufus_links/07_aisel_amcis2025_152.md'],
    'default': []
  }
};
```

**当前diagnose.js已实现此动态KB调取机制：**
- ✅ Step 3 — `02_sellerlabs_rufus_optimization.md` 调取完成，KB短语用于指导关键词提取
- ✅ Step 6 — `02_sellerlabs_rufus_optimization.md` + `03_amazon_science_rufus.md` 调取完成，KB信号词用于标题审核检查
- ⏳ Step 10/11 — 尚未实现（待后续迭代）
- ⏳ Step 12/13 — 尚未实现（违规检测基于内存规则）
