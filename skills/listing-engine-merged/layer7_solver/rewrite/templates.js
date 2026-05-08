// layer7_solver/rewrite/templates.js

const REWRITE_PATTERNS = [
  // 简化表达
  text => text.replace(/perfect for anyone dealing with/gi, "Ideal for"),

  // 去冗余
  text => text.replace(/very|really|extremely/gi, ""),

  // 压缩结构
  text => text.replace(/\s—\s/g, ": "),

  // 去重复词
  text => {
    const seen = new Set();
    return text
      .split(" ")
      .filter(w => {
        const key = w.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(" ");
  }
];