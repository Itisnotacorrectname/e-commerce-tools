function validateField(value, rules, fieldName) {
  let current = value || "";
  const violations = [];

  // 必填
  if (rules.required && !current) {
    violations.push({
      field: fieldName,
      type: "required",
      message: `${fieldName} is required`
    });

    current = rules.fallback || "";
  }

  // 类型
  if (rules.type === "string" && typeof current !== "string") {
    violations.push({
      field: fieldName,
      type: "type_error"
    });

    current = String(current);
  }

  // 长度
  if (rules.max_length && current.length > rules.max_length) {
    violations.push({
      field: fieldName,
      type: "max_length_exceeded",
      limit: rules.max_length
    });

    current = truncate(current, rules.max_length);
  }

  return {
    valid: violations.length === 0,
    fixedValue: current,
    fieldViolations: violations
  };
}

// 🔧 简单截断（后面可换smart）
function truncate(text, max) {
  return text.slice(0, max);
}