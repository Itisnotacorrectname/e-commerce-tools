# Amazon Listing Doctor — 工作规范 (CONVENTION.md)

> 修改此 skill 前必须通读本文件。所有规则必须遵守。

---

## 核心原则

1. **每次修改前备份** — `diagnose.js → diagnose.js.bak`，每次改动前执行
2. **sandbox 测试** — 修改先在 `sandbox/` 目录验证，不直接在 skill 目录测试
3. **通用逻辑** — 所有逻辑针对任意产品，不得硬编码特定产品词/品类词
4. **爬取逻辑独立** — `step2_worker.js` / `step4_worker.js` 等爬取模块与报告生成解耦，修改爬取不影响报告渲染

---

## 一、架构不变式

```
diagnose.js (orchestrator)
    ├── step1-15 (each returns raw data, saved as checkpoint)
    └── report_gen.js (reads checkpoints → generates HTML)
         └── generate(asin: string) → HTML string

隔离子进程（避免Amazon检测冲突）:
    step2_worker.js  — Playwright step2
    step4_worker.js  — Playwright step4
```

### 路径常量（禁止修改）
```
WORKSPACE        = 'C:/Users/csbd/.openclaw/workspace'
CHECKPOINT_DIR   = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints')
REPORT_DIR       = path.join(WORKSPACE, 'amazon-listing-doctor', 'reports')
SKILL_DIR        = path.join(WORKSPACE, 'skills', 'amazon-listing-doctor')
SANDBOX_DIR      = path.join(WORKSPACE, 'sandbox')
```

---

## 二、数据流不变式

```
loadCp(asin, n)   → 纯JSON对象（不含 .data 包装）
deps[n]           = { data: result }  — result是原始数据
result            = cp（直接从checkpoint，不走 .data）
```

### Checkpoint 字段要求（每个step必须满足）

| Step | 必须字段 | 类型 |
|------|---------|------|
| step1 | `asin`, `inputUrl` | string |
| step2 | `title`, `bullets`, `price`, `rating`, `reviewCount`, `BSR`, `category` | 多种 |
| step3 | `primaryKeyword`, `coreProduct`, `foundPhrases`, `sizeSignals` | 多种 |
| step4 | `competitors` (array), `totalFound` (int), `cascadeRounds` | 多种 |
| step5 | `primary` (array), `secondary` (array), `backend` (array) | array |
| step6 | `issues` (array), `titleLength` (int) | 多种 |
| step7 | `versionA/B/C`, `recommendation` | string |
| step8 | `backend` (string), `byteCount` (int) | 多种 |
| step9 | `optimized` (array) | array |
| step10 | `questions` (array), `scores` (array), `averageScore` | 多种 |
| step11 | `violations` (array), `totalViolations` (int) | 多种 |
| step12 | `egeoFeatures` (array), `missingFeatures` (int) | 多种 |
| step13 | `issues` (array), `weight` (string) | 多种 |
| step14 | `plan` (array of {priority, action, location}) | array |
| step15 | `anomalies` (array of {section, item}) | array |

---

## 三、报告结构规范（15个Section，不跳号）

```
1. Current Listing Audit
2. Current Title Issues
3. Competitor Benchmark
4. Category Keyword Universe
5. Three Optimized Title Versions
6. Backend Search Terms
7. Bullet Point Optimization
8. Rufus User Intent + Cosmo Score
9. Explicit Violations
10. E-GEO Feature Coverage
11. Listing Weight Improvement
12. Listing Quality Score         ← 必须有
13. Priority Action Plan
14. Competitor Anomalies          ← 必须有
15. Data Anomalies
```

**规则**：
- 不得跳过编号
- 每个section必须有实际内容（不允许"no data"就跳过）
- violations: 必须含 rule、bullet号、matched关键词
- plan: 必须含 priority(P0-P3)、action、location

---

## 四、修改Checklist（每次必勾）

```
□ 备份：cp diagnose.js diagnose.js.bak（时间戳可选）
□ 逻辑通用性：没有硬编码产品词吗？
□ sandbox测试：改动先在 sandbox/ 验证？
□ 数据结构变了？→ 需要清空 checkpoints 再测
□ 测试通过：node diagnose.js B0GVRS65WW
  → 报告 > 15000 bytes
  → 15个section都在，无跳号
  → step2 title完整（非截断词）
  → step4 totalFound ≥ 2
  → step11 violations ≥ 1
  → 无 STEP*_MISSING 输出
□ 检查 console.log 无重复
□ 更新本 CONVENTION.md（如有变更）
```

---

## 五、测试规范

**测试ASIN**：`B0GVRS65WW`（Power Tower Pull Up Bar，健身房设备）

**标准测试流程**：
```
1. 清空: rm -rf amazon-listing-doctor/checkpoints/B0GVRS65WW
2. 运行: node diagnose.js B0GVRS65WW
3. 检查输出:
   - 无 STEP*_MISSING
   - 无 "undefined" 报错
   - 无 path TypeError
   - console.log 无重复行
4. 验证报告:
   - 文件 > 15000 bytes
   - 15个 section 完整
   - 违规数据准确（3条显性 + 1条隐性）
   - 行动计划 ≥ 5条
   - 无 "Recycled materials" 这类截断标题
5. 每轮测试记录到 memory/YYYY-MM-DD.md
```

**通用性验证**（可选第二步）：
- 用不同产品测试（如 mattress、slush machine 等）
- 验证 step4 竞品标题不是截断的通用词组

---

## 六、文件结构

```
amazon-listing-doctor/
├── diagnose.js           ← 主orchestrator（修改前备份）
├── report_gen.js         ← HTML生成（修改前备份）
├── step2_worker.js       ← Playwright隔离子进程
├── step4_worker.js       ← Playwright隔离子进程
├── generate_pdf.js       ← 可选，PDF生成
├── SKILL.md            ← Skill定义
├── CONVENTION.md       ← 本文件（工作规范）
├── workflow.md         ← 流程说明
└── sandbox/            ← 测试脚本目录
    ├── test_step4.js    ← step4专项测试
    ├── test_step2.js    ← step2专项测试
    └── test_report.js   ← 报告验证测试

checkpoints/:  amazon-listing-doctor/checkpoints/{ASIN}/step{N}.json
reports/:      amazon-listing-doctor/reports/{ASIN}/{ASIN}.html
```

---

## 七、已知问题（已修复）

| 优先级 | 问题 | 影响 | 状态 |
|--------|------|------|------|
| P1 | step4竞品标题被截断为通用词组 | step7/step5数据差 | ✅ 已修复（selector h2>span + 清理通用词黑名单） |
| P1 | Section 12/14缺失 | 报告跳号 | ✅ 已修复（report_gen.js添加） |
| P2 | anomalyItems在footer只显示数量 | 用户看不到具体内容 | ✅ 已修复（完整渲染） |
| P3 | console.log重复一行 | 输出冗余 | ✅ 已修复（diagnose.js line813） |
| P2 | GENERIC_SINGLE_WORD_BLACKLIST含product词 | 违反通用性规范 | ✅ 已修复（mattress/chair/table等移除） |

---

## 八、修改触发条件（每次开始修改skill前）

> **重要**：每次开始修改 amazon-listing-doctor 相关文件前，必须：
> 1. 读取 `CONVENTION.md`
> 2. 读取 `SKILL.md`（了解当前skill状态）
> 3. 执行备份命令
> 4. 在 sandbox/ 验证后再动主文件