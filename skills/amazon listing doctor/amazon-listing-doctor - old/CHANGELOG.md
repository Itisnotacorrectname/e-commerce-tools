# Changelog — Amazon Listing Doctor

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
