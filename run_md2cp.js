const { spawn } = require('child_process');
const path = require('path');

const env = Object.assign({}, process.env);
env.OPENCLAW_WORKSPACE = 'C:/Users/csbd/.openclaw/workspace/e-commerce-tools/version_comparison/v1.9.1';

const child = spawn('node', [
  path.join('C:/Users/csbd/.openclaw/workspace/e-commerce-tools/skills/amazon listing doctor/amazon-listing-doctor - v1.9.1', 'md_to_checkpoints.js'),
  'B0FY2H5DC1'
], { env, stdio: 'inherit', cwd: 'C:/Users/csbd/.openclaw/workspace/e-commerce-tools/version_comparison/v1.9.1' });

child.on('exit', (code) => process.exit(code));
