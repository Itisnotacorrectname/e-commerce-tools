---

## Phase 4: 对话分析后注入报告（v1.4.3 新增）

### 问题背景

Claude 在对话中完成分析后，分析结果仅存在于对话上下文，并未写入 checkpoint，导致 HTML 报告仍然显示"待 Claude 分析"占位符。

### 解决方案：inject_analysis.js

新增脚本位于 skill 根目录，使用方式：

```bash
node inject_analysis.js <ASIN> <analysis.json>
# 或从 stdin 读取：
node inject_analysis.js <ASIN> --stdin  < analysis.json
```

**analysis.json 格式：**

```json
{
  "step5":  { "primary": ["cookware set","nonstick"], "secondary": ["ceramic"], "backend": ["rv pots"] },
  "step6":  { "issues": ["RV属性未前置"], "score": 72 },
  "step7":  { "versionA": "...", "versionB": "...", "versionC": "...", "versionAChars": 189, "versionBChars": 176, "versionCChars": 152, "versionANote": "...", "versionBNote": "...", "versionCNote": "..." },
  "step8":  { "backend": "rv pots pans nonstick ceramic oven safe", "byteCount": 180 },
  "step9":  { "bullets": [{"original": "...", "rewrite": "...", "explanation": "..." }] },
  "step10": { "questions": ["Q1: ...?", "Q2: ...?", "Q3: ...?"] },
  "step11": { "scores": [{"question": "...", "score": 4, "label": "间接涉及", "evidence": "..." }], "avg": 4.0 },
  "step12": { "explicit": [{"severity": "high", "rule": "...", "id": "V1", "matched": "...", "explanation": "..." }], "implicit": [] },
  "step13": { "summary": "...", "issues": [{"factor": "...", "current": "...", "action": "...", "impact": "medium"}] },
  "step14": { "actions": [{"priority": "P0", "action": "...", "location": "title", "impact": "搜索排名提升"}] }
}
```

### 工作流

1. **对话完成分析** → 输出完整分析结论（markdown）
2. **生成 analysis.json** → 将对话结论整理为上述 JSON 格式
3. **调用 inject_analysis.js** → 写入所有 step5-14 checkpoint，重新生成 HTML
4. **确认报告** → 验证 HTML 报告无"待 Claude 分析"占位符

### 验证命令

```bash
# 检查 step 文件数量（应为 14）
ls {CHECKPOINT_DIR}/{ASIN}/step*.json | wc -l

# 确认 HTML 无占位符
grep "待 Claude 分析" {REPORT_DIR}/{ASIN}/{ASIN}.html
# 应返回空
```

### HTML 报告更新机制

inject_analysis.js 调用 report_gen.js 的 `generate(asin)` 函数，传入已写入的 step5-14 数据，生成完整 HTML。无需手动调用 report_gen.js。