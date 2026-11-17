export class RouterOsError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RouterOsError";
    this.status = options.status;
    this.code = options.code;
    this.device = options.device;
  }
}

export class ReadOnlyViolationError extends RouterOsError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ReadOnlyViolationError";
  }
}

const TLS_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID"
]);

function deviceLabel(device) {
  return `"${device.name}" (${device.host}:${device.port})`;
}

function serverMessage(text) {
  if (!text) return "";
  let message = text;
  try {
    const parsed = JSON.parse(text);
    message = parsed.message ?? parsed.error ?? text;
  } catch {
    // Plain text error body, use as-is.
  }
  const cleaned = String(message).replace(/\s+/g, " ").trim();
  return cleaned.length > 200 ? `${cleaned.slice(0, 200)}...` : cleaned;
}

export function httpError(device, status, text) {
  const detail = serverMessage(text);
  const suffix = detail && status !== 401 && status !== 403 ? ` Server said: ${detail}` : "";

  if (status === 401) {
    return new RouterOsError(
      `Authentication failed for device ${deviceLabel(device)} (HTTP 401). Check the user and password for "${device.name}".`,
      { status, device: device.name }
    );
  }
  if (status === 403) {
    return new RouterOsError(
      `Device ${deviceLabel(device)} denied access (HTTP 403). Give the router user the read, api and rest-api policies.${suffix}`,
      { status, device: device.name }
    );
  }
  if (status === 404) {
    return new RouterOsError(
      `Resource not found on device ${deviceLabel(device)} (HTTP 404). The menu may not exist on this RouterOS version.${suffix}`,
      { status, device: device.name }
    );
  }

  return new RouterOsError(
    `Device ${deviceLabel(device)} returned HTTP ${status}.${suffix}`,
    { status, device: device.name }
  );
}

export function networkError(error, device) {
  if (error instanceof RouterOsError) {
    return error;
  }

  const label = deviceLabel(device);

  if (error.code === "ECONNREFUSED") {
    return new RouterOsError(
      `Cannot connect to device ${label}: connection refused. Check that the REST service (www-ssl) is enabled and the port is correct.`,
      { code: error.code, device: device.name, cause: error }
    );
  }
  if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
    return new RouterOsError(
      `Cannot resolve host for device ${label}. Check the host value in the config.`,
      { code: error.code, device: device.name, cause: error }
    );
  }
  if (error.code === "ETIMEDOUT" || error.code === "ESOCKETTIMEDOUT") {
    return new RouterOsError(
      `Request to device ${label} timed out after ${device.timeoutMs} ms.`,
      { code: error.code, device: device.name, cause: error }
    );
  }
  if (error.code === "ECONNRESET") {
    return new RouterOsError(
      `Connection to device ${label} was reset. Check the router's firewall or service settings.`,
      { code: error.code, device: device.name, cause: error }
    );
  }
  if (TLS_ERROR_CODES.has(error.code)) {
    return new RouterOsError(
      `TLS certificate for device ${label} is not trusted (${error.code}). Import the router CA into the host trust store, or set "insecure": true for lab devices only.`,
      { code: error.code, device: device.name, cause: error }
    );
  }

  return new RouterOsError(
    `Network error talking to device ${label}: ${error.message}`,
    { code: error.code, device: device.name, cause: error }
  );
}
