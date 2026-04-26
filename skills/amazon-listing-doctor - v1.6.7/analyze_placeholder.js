const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');

async function main() {
  const asin = process.argv[2];
  if (!asin) { console.error('Usage: node analyze.js <ASIN>'); process.exit(1); }

  console.error('===========================================');
  console.error('  Analysis Phase (Step 5-14)');
  console.error('  ASIN: ' + asin);
  console.error('===========================================');

  // Load data package
  const pkgPath = path.join(CHECKPOINT_DIR, asin, 'data_package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('FATAL: data_package.json not found for ' + asin);
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const competitorList = (pkg.competitors?.items || pkg.competitors || []);

  // Build prompt for OpenClaw agent
  const prompt = `请分析以下 Amazon 产品 listing，生成完整的分析 JSON。

产品信息：
- ASIN: ${asin}
- Title: ${pkg.product?.title || ''}
- Brand: ${pkg.product?.brand || ''}
- Price: $${pkg.product?.price || 'N/A'}
- Rating: ${pkg.product?.rating || ''}
- Category: ${pkg.product?.category || ''}
- Bullets:
${(pkg.product?.bullets || []).map((b,i) => '  ' + (i+1) + '. ' + b).join('\n')}

竞品数量: ${competitorList.length} 个（仅展示前5个）
${competitorList.slice(0, 5).map(c => '- ' + (c.title||'').substring(0,80)).join('\n')}

请以 JSON 格式输出完整的 10 个分析步骤（step5 到 step14），格式如下：
{
  "step5": { "primary": ["关键词1","关键词2"], "secondary": ["关键词3"], "backend": ["后端词1"] },
  "step6": { "issues": [{ "type": "问题类型", "severity": "high|medium|low", "detail": "问题描述" }], "score": 0-100 },
  "step7": { "versionA": "标题版本A", "versionB": "标题版本B", "versionC": "标题版本C", "versionAChars": 数字, "versionBChars": 数字, "versionCChars": 数字, "versionANote": "版本A备注", "versionBNote": "版本B备注", "versionCNote": "版本C备注" },
  "step8": { "backend": "后端关键词短语", "byteCount": 数字 },
  "step9": { "bullets": [{ "original": "原文", "rewrite": "改写", "explanation": "改写理由" }] },
  "step10": { "questions": ["Q1: 问题文本", "Q2: 问题文本"] },
  "step11": { "scores": [{ "question": "问题", "score": 0-5, "label": "标签", "evidence": "证据", "enhancement": "改进建议" }], "avg": 平均分 },
  "step12": { "explicit": [{ "id": "V编号", "severity": "high|medium|low", "rule": "规则描述", "matched": "匹配内容", "explanation": "解释" }], "implicit": [{ "id": "I编号", "severity": "high|medium|low", "rule": "规则描述", "matched": "匹配内容", "explanation": "解释" }] },
  "step13": { "summary": "listing权重总结", "issues": [{ "factor": "因素", "current": "当前状态", "action": "建议操作", "impact": "high|medium|low" }] },
  "step14": { "actions": [{ "priority": "P0|P1|P2", "action": "行动描述", "location": "应用位置", "impact": "影响说明" }] }
}

只输出 JSON，不要有其他文字。`.trim();

  // Write prompt to temp file for OpenClaw agent
  const promptPath = path.join(WORKSPACE, 'temp_analysis_prompt_' + asin + '.txt');
  fs.writeFileSync(promptPath, prompt, 'utf8');

  console.error('Prompt written to: ' + promptPath);
  console.error('');
  console.error('===========================================');
  console.error('  ⚠️  AI analysis requires OpenClaw agent session');
  console.error('  请在 OpenClaw 主会话中运行以下命令：');
  console.error('');
  console.error('  node inject_analysis.js ' + asin + ' <分析结果.json>');
  console.error('');
  console.error('  或使用 sessions_spawn 启动分析会话');
  console.error('===========================================');

  // Check for API key - if available, try direct AI call
  const apiKey = process.env.MINIMAX_API_KEY || '';
  if (!apiKey) {
    console.error('');
    console.error('注意: MINIMAX_API_KEY 未设置，无法自动执行 AI 分析。');
    console.error('请配置环境变量 MINIMAX_API_KEY 后重试。');
  }
}

main();