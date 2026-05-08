const { spawn } = require('child_process');
const path = require('path');

const version = process.argv[2] || 'v1.9';
const base = 'C:/Users/csbd/.openclaw/workspace/e-commerce-tools';
const workspace = base + '/version_comparison/' + version;
const skillDir = base + '/skills/amazon listing doctor/amazon-listing-doctor - ' + version;

// Check if md_to_checkpoints exists
const fs = require('fs');
const md2cp = path.join(skillDir, 'md_to_checkpoints.js');
if (!fs.existsSync(md2cp)) {
  console.log('[ERROR] md_to_checkpoints.js not found for ' + version);
  process.exit(1);
}

const env = Object.assign({}, process.env);
env.OPENCLAW_WORKSPACE = workspace;

const child = spawn('node', [md2cp, 'B0FY2H5DC1'], { env, stdio: 'inherit', cwd: workspace });
child.on('exit', (code) => process.exit(code));
