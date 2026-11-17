export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

export function firstObject(value) {
  if (Array.isArray(value)) {
    return value.length > 0 && value[0] && typeof value[0] === "object" ? value[0] : {};
  }
  if (value && typeof value === "object") return value;
  return {};
}

export function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}

export function pickFields(row, fields) {
  const result = {};
  if (!row || typeof row !== "object") return result;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      result[field] = row[field];
    }
  }
  return result;
}

export function matchesSearch(row, term, fields) {
  if (!term) return true;
  const needle = String(term).toLowerCase();
  return fields.some((field) => {
    const value = row?.[field];
    return value !== undefined && String(value).toLowerCase().includes(needle);
  });
}
