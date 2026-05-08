# Amazon Listing Doctor v2.6-mimo

**状态：** ✅ 可用
**最后更新：** 2026-05-07

---

## 这个 Skill 能干嘛

**诊断任何 Amazon 产品页面**，给出完整的优化建议。像一个资深运营总监帮你看 listing。

### 输入
- 一个 Amazon 产品链接（`amazon.com/dp/ASIN`）
- 或直接给 ASIN 编号

### 输出
- **HTML 诊断报告**：15 个章节，包含评分、问题、优化建议、竞品对比
- **诊断数据**：结构化的 JSON 数据，可供进一步分析

---

## 怎么用

### 方式 1：直接给链接
```
帮我诊断这个 listing：https://www.amazon.com/dp/B09PV32NNK
```

### 方式 2：给 ASIN
```
诊断 B09PV32NNK
```

### 方式 3：命令行
```bash
node skills/amazon-listing-doctor-v2.6-mimo/diagnose.js B09PV32NNK
node skills/amazon-listing-doctor-v2.6-mimo/diagnose.js B09PV32NNK --force  # 强制重新抓取
```

---

## 报告包含什么

| 章节 | 内容 |
|------|------|
| 1. Listing 审计 | 当前标题、五点、价格、评分、BSR 总览 |
| 2. 标题问题 | 重复词、过长、格式问题 |
| 3. 竞品对比 | 找到的竞品数据和对比 |
| 4. 关键词库 | 品类关键词分析 |
| 5. 优化标题 | 3 个优化版本建议 |
| 6. 后台搜索词 | 后台关键词优化 |
| 7. 五点优化 | Bullet points 改写建议 |
| 8. Rufus/Cosmo | AI 搜索意图分析 + 内容评分 |
| 9-15. 深度分析 | 事实核查、违规检测、E-GEO 评分等 |

---

## 工作流程

```
Phase 1（自动）：脚本爬取产品数据
    step1: 解析 ASIN
    step2: 爬取产品页（标题、五点、价格、评分、BSR）
    step3: 推断核心产品词
    step4: 搜索竞品
    step13: 爬取评论（≥10条评论时）

Phase 2（AI 执行）：Claude 分析数据
    按 SKILL.md 指导，分析 15 个维度
    写入 analysis.md

Phase 3（自动）：生成报告
    md_to_checkpoints.js 转换分析结果
    report_gen.js 生成 HTML 报告
```

---

## 文件结构

```
amazon-listing-doctor-v2.6-mimo/
├── SKILL.md                    # AI 执行指南（45KB，很详细）
├── README.md                   # ← 你在看的这个
├── CHANGELOG.md                # 更新记录
├── diagnose.js                 # 数据爬取脚本（712行）
├── step2_worker.js             # 产品页爬虫
├── step4_worker.js             # 竞品爬虫
├── step13_review_worker.js     # 评论爬虫
├── md_to_checkpoints.js        # 分析结果转换
├── report_gen.js               # HTML 报告生成
├── inject_analysis.js          # JSON 路线分析注入
├── lib/
│   └── amazon_scraper.js       # Playwright 爬虫核心（30.9KB）
├── references/
│   ├── rufus_test.md           # Rufus 问题模板
│   └── cosmo_evaluation.md     # Cosmo 评分规则
└── knowledge/
    └── README.md               # 可选知识库说明
```

### 用户数据（不在 skill 目录内）
```
workspace/amazon-listing-doctor/
├── checkpoints/{ASIN}/         # 每步的诊断数据
│   ├── step1.json              # ASIN 解析
│   ├── step2.json              # 产品页数据
│   ├── step3.json              # 核心产品词
│   ├── step4.json              # 竞品数据
│   ├── step13.json             # 评论数据
│   ├── analysis.md             # AI 分析结果
│   └── step5-14.json           # 转换后的分析数据
└── reports/{ASIN}/             # HTML 报告
    └── {ASIN}.html
```

---

## 当前状态

### ✅ 已完成
- Phase 1 完整流程（step1-4 + step13）
- 核心产品词提取（category-weighted 算法）
- 竞品搜索和过滤
- 评论爬取
- HTML 报告生成

### ⚠️ 已知限制
- Phase 2 需要 Claude Agent 手动执行（不是全自动）
- 评论爬取依赖 Playwright，可能被 Amazon 反爬
- 竞品搜索词基于 title bigram，可能不够精准

### 🔜 待实现
- Fact-Check（事实核查）代码实现
- 动态 bullet 排序代码实现
- Phase 2 自动触发（可选）

---

## 技术细节（给开发者的）

### 架构：Route B
```
脚本只爬虫 → Claude 只分析 → 脚本只渲染
```

### 核心算法：coreProduct 提取
1. 从 title 提取 trigrams（3词短语）和 bigrams（2词短语）
2. 用 PRODUCT_TYPE_WORDS 评分（产品类型词越多分越高）
3. 用 category 末段词加权（catBoost）
4. 优先选 trigram ≥ 2 产品类型词的
5. 验证：category 词必须在 title 中出现

### 依赖
- Node.js（内置模块，无需 npm install）
- Playwright（爬虫用，需单独安装）
- MiniMax API（可选，用于 LLM 分析）

---

_由 Kane 和 AI 共同维护。修改前请读 CONVENTION.md。_
