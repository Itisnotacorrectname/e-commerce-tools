# Changelog — Amazon Listing Doctor

## v2.5 (2026-05-07)

### 竞品数据增强
- `lib/amazon_scraper.js`：`scrapeCompetitorSearch` 的4个策略入口全部新增 **price + rating** 提取
  - 新增 `extractCompPriceRating($, el)` 辅助函数
  - price：多 selector fallback（`.a-price .a-offscreen` → `.a-price-whole` → `.a-color-price`）
  - rating：`.a-icon-alt` 提取星级文本
  - 4个入口：Legacy UI `[data-asin]`、New AUI `[data-csa-c-type="item"]`、Extra rounds × 2
- `report_gen.js`：竞品表格新增 **Price + Rating** 列（Section 3）

### 评论抓取（Step13 Review Analysis）
- 新增 `step13_review_worker.js` — Playwright 评论爬虫
  - 从产品页内嵌评论区提取（Amazon 设计限制约8条，非代码问题）
  - 抓取字段：星级、标题、正文、helpful票、Verified标记、日期
  - 标题清洗：去除星级数字前缀和换行符
- `diagnose.js`：新增 Step13 调用逻辑，reviewCount<10 时跳过；数据写入 `step15.json`
- `report_gen.js`：新增 **Section 12.5 Customer Review Analysis**
  - KPI卡：Reviews Analyzed / Avg Rating / Rating Distribution
  - Top Complaints：从1-2★评论提取主题（wobble/stability/assembly/size等keyword聚类）
  - Sample Negative Reviews：1-2★典型差评
  - Sample Positive Reviews：4-5★典型好评

### 反检测升级（参考 universal-scraper v2.0）
- `lib/amazon_scraper.js`
  - `createBrowser()`：新增 `--disable-web-security --lang=en-US`
  - `createPageContext()`：新增 `TZ_MAP` 时区映射，完整 viewport/locale/timezone 配置
  - `newPage()` 全部改用 `createPageContext(cc)` 上下文
  - `handleCookieConsent()`：扩展选择器（`#sp-cc-accept-all`、`:has-text()` 等7种）
  - `handleInterstitial()`：扩展按钮选择器（5种）和弹窗文本检测（新增 `Continuer vos achats`）
- `step13_review_worker.js`：同步升级为相同配置

### 文件清理
- 删除9个无用文件：`test_gateway.js`, `test_llm_standalone.js`, `diagnose.js.bak`, `diagnose.js.bak_v2.4_P0fix`, `step4_worker.js.bak_v2.4_P0fix`, `stepLLM.js`, `step10_external.js`, `SKILL v2.0.md`, `generate_pdf.js`

### 测试结果（B0F8B2RKRH — Jusgym Pull Up Station）
- 竞品：31个，26个有价格数据（$29.89~$149）
- 评论：8条（产品页内嵌上限），含1★/3★/4★/5★
- Top Complaint：stability（来自 "Shameful Quality" 差评）
- 报告路径：`amazon-listing-doctor/reports/B0F8B2RKRH/B0F8B2RKRH.html`

### 已知限制
- 评论数量受 Amazon 产品页内嵌限制（约8条），完整评论需独立 reviews 页（被反爬拦截）
- Star distribution 0%：产品页不返回评分分布条
- Action Plan / Cosmo Q 方向优化暂未实施（依赖 Review Analysis 数据）

---

## v2.3-KB-hybrid (2026-05-01)

### Fusion: v2.3 (Route B) + v5.2 (KB Integration)

**核心改动：**
- `diagnose.js` → 替换为 v2.3 Route B 架构（Step 1-4 爬虫数据层，竞品 cascade 修复）
  - 修复：v5.2 原版 Step 4 hardcoded `return { competitors: [] }`，竞品数为 0
  - v2.3 Step 4：coreProduct search → foundPhrases fallback → categoryFallback，动态 cascade
- `step2_worker.js` / `step4_worker.js` → 从 v2.3 复制
- `lib/amazon_scraper.js` / `lib/amazon_price.js` → 从 v2.3 复制
- `report_gen.js` / `inject_analysis.js` / `md_to_checkpoints.js` → 从 v2.3 复制
- `SKILL.md` → 保留 v2.3 Phase 2 分析逻辑（A-K 步骤），叠加 Kane 私人知识库说明

**验证：**
- B0FR7P2KXS 实测：16 个竞品 → 14 个可用（vs v5.2 的 0 个）✅

**Knowledge Base 集成：**
- `references/kb_retrieval_rules.md` → 保留 v5.2 的 KB 动态调用规则（Step 3/6/10/11/12/13/15）
- 私人 KB 路径：`C:/Users/csbd/.openclaw/workspace/亚马逊分析知识库/knowledge/`
- 不复制文件到 skill 内，通过绝对路径引用

**遗留（未完成）：**
- Phase 2 分析（Step 5-14）仍需 Agent 手动执行或 LLM 批量处理
- `stepLLM.js` / `step10_external.js` 为 v5.2 遗留文件，待清理

---

## v5.2 (skills/amazon-listing-doctor/) — 已废弃

- Step 4 hardcoded bug：`return { competitors: [], cascadeRounds: [], totalFound: 0 }`
- 已被 v2.3-KB-hybrid 替换

## v2.3 (e-commerce-tools/) — 历史存档

- 路径：`e-commerce-tools/skills/amazon-listing-doctor - v2.3/`
- Route B 架构，数据层 + SKILL.md 分析
- Step 4 竞品 cascade 正常工作
