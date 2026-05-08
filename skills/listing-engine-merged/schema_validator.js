function validateListing(listing, schema) {
  const result = {};
  const violations = [];

  for (const field in schema) {
    const rules = schema[field];
    const value = listing[field];

    const { valid, fixedValue, fieldViolations } =
      validateField(value, rules, field);

    result[field] = fixedValue;
    violations.push(...fieldViolations);
  }

  return {
    data: result,
    violations
  };
}