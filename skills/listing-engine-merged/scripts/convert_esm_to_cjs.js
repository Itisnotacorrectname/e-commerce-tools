/**
 * scripts/convert_esm_to_cjs.js
 * Converts a directory of ESM files to CJS for the merged skill.
 * Run: node scripts/convert_esm_to_cjs.js <directory>
 */
const fs = require('fs');
const path = require('path');

function convertFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Convert "import { x } from 'y';" → "const { x } = require('y');"
  // Convert "import x from 'y';" → "const x = require('y').default || require('y');"
  // Convert "import * as x from 'y';" → "const x = require('y');"
  content = content.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];$/gm, (match, imports, mod) => {
    modified = true;
    return `const { ${imports} } = require('${mod}');`;
  });
  content = content.replace(/^import\s+(\*)\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];$/gm, (match, star, name, mod) => {
    modified = true;
    return `const ${name} = require('${mod}');`;
  });
  content = content.replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];$/gm, (match, name, mod) => {
    modified = true;
    return `const ${name} = require('${mod}');`;
  });

  // Convert "export async function x" → "async function x" + "module.exports.x = x"
  content = content.replace(/^export\s+async\s+function\s+(\w+)/gm, (match, name) => {
    modified = true;
    return `async function ${name}`;
  });
  content = content.replace(/^export\s+function\s+(\w+)/gm, (match, name) => {
    modified = true;
    return `function ${name}`;
  });
  content = content.replace(/^export\s+const\s+(\w+)\s+=/gm, (match, name) => {
    modified = true;
    return `const ${name} =`;
  });

  // Convert "export { x, y }" at end of file → "module.exports = { x, y }" or individual
  // For "export { x };" standalone, convert to "module.exports.x = x;"
  // This is tricky - we'll handle named exports separately

  // Convert export default
  content = content.replace(/^export\s+default\s+(?:function|const|async|class)/gm, (match) => {
    modified = true;
    return match.replace(/^export\s+default\s+/, '');
  });

  // Remove standalone "export {};" lines
  content = content.replace(/^export\s+\{[^}]*\};$/gm, (match) => {
    modified = true;
    return '';
  });

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Converted: ' + filePath);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() && !file.startsWith('.') && !file.startsWith('node_modules')) {
      walkDir(fullPath);
    } else if (file.endsWith('.js')) {
      convertFile(fullPath);
    }
  }
}

const targetDir = process.argv[2] || '.';
walkDir(targetDir);
console.log('Done converting ESM → CJS in: ' + targetDir);
