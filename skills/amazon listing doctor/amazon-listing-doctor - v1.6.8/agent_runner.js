/**
 * agent_runner.js — v1.6.8
 * Spawns OpenClaw sub-agent to execute SKILL.md Phase 2 analysis.
 *
 * The sub-agent (me) reads SKILL.md, executes step5-14 analysis,
 * writes checkpoints via write tool, then generates HTML report.
 */
const path = require('path');
const { sessions_spawn } = require('./sessions_wrapper.js');

const SKILL_DIR = __dirname;
const ASIN = process.argv[2] || process.env.ANALYSIS_ASIN;

function runAnalysis(asin, callback) {
  if (!asin) {
    callback(new Error('No ASIN provided'), null);
    return;
  }

  var task = buildTask(asin);
  var label = 'listing-analysis-' + asin;

  console.error('agent_runner: spawning sub-agent for ASIN=' + asin);

  // Spawn a sub-agent that will perform the analysis
  sessions_spawn({
    task: task,
    label: label,
    runtime: 'subagent',
    mode: 'run',
    runTimeoutSeconds: 600,  // 10 min timeout for full analysis
    cleanup: 'keep'
  }).then(function(sessionKey) {
    console.error('agent_runner: sub-agent started, session=' + sessionKey);
    // The sub-agent handles everything: step5-14 checkpoints + report_gen.js
    // When done, it will have written the HTML report
    callback(null, null);  // Report path will be shown by the sub-agent
  }).catch(function(err) {
    console.error('agent_runner: spawn failed - ' + err.message);
    callback(err, null);
  });
}

function buildTask(asin) {
  return (
    'Execute Amazon Listing analysis for ASIN: ' + asin + '.\n\n' +
    'Read SKILL.md (located at ' + SKILL_DIR + '/SKILL.md) for the complete analysis framework.\n' +
    'Execute Phase 2 steps A-K (step5-14) as defined in SKILL.md.\n' +
    'For each step, use the write tool to save the checkpoint JSON to:\n' +
    '  CHECKPOINT_DIR/amazon-listing-doctor/checkpoints/' + asin + '/step{N}.json\n\n' +
    'CHECKPOINT_DIR = your workspace path (C:/Users/csbd/.openclaw/workspace).\n\n' +
    'After all checkpoints are written, execute:\n' +
    '  node ' + SKILL_DIR + '/report_gen.js ' + asin + '\n' +
    'to generate the HTML report.\n\n' +
    'IMPORTANT: Use write tool for every checkpoint. Do not skip any step.\n' +
    'Report the final HTML path when complete.'
  );
}

// Allow require for testing
module.exports = { runAnalysis };

// Allow CLI: node agent_runner.js <ASIN>
if (require.main === module && process.argv[2]) {
  runAnalysis(process.argv[2], function(err, reportPath) {
    if (err) {
      console.error('FATAL: ' + err.message);
      process.exit(1);
    }
    process.exit(0);
  });
}
