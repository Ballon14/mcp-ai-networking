const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "password",
  "passphrase",
  "secret",
  "psk",
  "pre-shared-key",
  "wpa-pre-shared-key",
  "wpa2-pre-shared-key",
  "wpa-psk",
  "wpa2-psk",
  "private-key",
  "auth-key",
  "authentication-key",
  "community",
  "wep-key",
  "key"
]);

const SENSITIVE_SUFFIXES = ["-secret", "-password", "-passphrase", "-psk"];

export function isSensitiveKey(key) {
  const normalized = String(key).toLowerCase();
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function redactObject(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth > 20) return "[TRUNCATED]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, depth + 1, seen));
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactObject(item, depth + 1, seen);
  }
  return result;
}

export function redactText(text) {
  if (typeof text !== "string") return text;
  return text.replace(
    /(password|passphrase|secret|psk|pre-shared-key|private-key|community|key)\s*=\s*("[^"]*"|'[^']*'|\S+)/gi,
    "$1=[REDACTED]"
  );
}

export { REDACTED };
