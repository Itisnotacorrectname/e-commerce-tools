const ATTRIBUTE_MAP = {
  size: ["size", "product size", "dimensions", "dimension"],
  color: ["color", "colour"],
  material: ["material", "fabric"],
  brand: ["brand", "manufacturer"],
  weight: ["weight", "item weight"]
};

function normalizeAttributes(rawAttrs = {}) {
  const normalized = {};

  for (const rawKey in rawAttrs) {
    const cleanKey = normalizeKey(rawKey);

    const targetKey = mapToStandardKey(cleanKey);

    if (!targetKey) continue;

    const value = normalizeValue(rawAttrs[rawKey]);

    if (!value) continue;

    normalized[targetKey] = {
      value,
      source_key: rawKey
    };
  }

  return normalized;
}

// 🔑 key标准化
function normalizeKey(key) {
  return key
    .toLowerCase()
    .replace(/[_\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 🧠 映射标准key
function mapToStandardKey(key) {
  for (const standard in ATTRIBUTE_MAP) {
    if (ATTRIBUTE_MAP[standard].includes(key)) {
      return standard;
    }
  }
  return null;
}

// 🧼 value清洗
function normalizeValue(value) {
  if (!value) return null;

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}