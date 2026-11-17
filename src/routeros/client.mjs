import http from "node:http";
import https from "node:https";
import {
  RouterOsError,
  ReadOnlyViolationError,
  httpError,
  networkError
} from "./errors.mjs";

const ALLOWED_POST_PATHS = new Set(["/rest/ping"]);
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 500;

function base64Credentials(user, password) {
  return Buffer.from(`${user}:${password}`, "utf8").toString("base64");
}

export class RouterOsClient {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.agents = new Map();
    this.lastRequestAt = new Map();
  }

  async get(device, apiPath, options = {}) {
    return this.request(device, apiPath, { ...options, method: "GET" });
  }

  async request(device, apiPath, options = {}) {
    const {
      method = "GET",
      body,
      cacheTtlMs = 0
    } = options;

    if (typeof apiPath !== "string" || !apiPath.startsWith("/rest/")) {
      throw new RouterOsError(
        `Refusing to call a non-REST path: ${String(apiPath)}`
      );
    }

    if (method !== "GET") {
      const allowedPost = method === "POST" && ALLOWED_POST_PATHS.has(apiPath);
      if (!allowedPost) {
        throw new ReadOnlyViolationError(
          `Read-only mode: ${method} ${apiPath} is blocked. This server never changes router configuration.`
        );
      }
    }

    const cacheKey = `${device.name}:${method}:${apiPath}:${body ? JSON.stringify(body) : ""}`;
    if (method === "GET" && cacheTtlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
      this.cache.delete(cacheKey);
    }

    await this.waitForRateLimit(device);

    const value = await this.send(device, apiPath, method, body);

    if (method === "GET" && cacheTtlMs > 0) {
      this.storeCache(cacheKey, { value, expiresAt: Date.now() + cacheTtlMs });
    }

    return value;
  }

  async waitForRateLimit(device) {
    const minIntervalMs = device.minIntervalMs ?? 0;
    if (minIntervalMs <= 0) {
      return;
    }
    const now = Date.now();
    const last = this.lastRequestAt.get(device.name) ?? 0;
    const waitMs = Math.max(0, last + minIntervalMs - now);
    this.lastRequestAt.set(device.name, now + waitMs);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  storeCache(key, entry) {
    this.cache.set(key, entry);
    if (this.cache.size <= MAX_CACHE_ENTRIES) {
      return;
    }
    const now = Date.now();
    for (const [cacheKey, cached] of this.cache) {
      if (cached.expiresAt <= now) {
        this.cache.delete(cacheKey);
      }
    }
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  getAgent(device, isHttps) {
    const key = `${isHttps ? "https" : "http"}:${device.insecure ? "insecure" : "secure"}`;
    if (!this.agents.has(key)) {
      this.agents.set(
        key,
        isHttps
          ? new https.Agent({
              keepAlive: true,
              rejectUnauthorized: device.insecure !== true
            })
          : new http.Agent({ keepAlive: true })
      );
    }
    return this.agents.get(key);
  }

  send(device, apiPath, method, body) {
    const url = new URL(`${device.baseUrl}${apiPath}`);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);

    const headers = {
      Authorization: `Basic ${base64Credentials(device.user, device.password)}`,
      Accept: "application/json"
    };
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (handler, value) => {
        if (settled) return;
        settled = true;
        handler(value);
      };

      const req = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          agent: this.getAgent(device, isHttps)
        },
        (res) => {
          res.on("error", (error) => finish(reject, networkError(error, device)));

          const chunks = [];
          let size = 0;

          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              req.destroy(
                new RouterOsError(
                  `Response from device "${device.name}" exceeded ${MAX_RESPONSE_BYTES} bytes. Narrow the query with filters and try again.`,
                  { device: device.name }
                )
              );
              return;
            }
            chunks.push(chunk);
          });

          res.on("end", () => {
            if (res.statusCode >= 400) {
              const text = Buffer.concat(chunks).toString("utf8");
              finish(reject, httpError(device, res.statusCode, text));
              return;
            }
            const text = Buffer.concat(chunks).toString("utf8");
            if (text.trim() === "") {
              finish(resolve, null);
              return;
            }
            try {
              finish(resolve, JSON.parse(text));
            } catch {
              finish(
                reject,
                new RouterOsError(
                  `Device "${device.name}" returned invalid JSON for ${apiPath}.`,
                  { device: device.name }
                )
              );
            }
          });
        }
      );

      req.setTimeout(device.timeoutMs, () => {
        req.destroy(
          new RouterOsError(
            `Request to device "${device.name}" timed out after ${device.timeoutMs} ms.`,
            { code: "ETIMEDOUT", device: device.name }
          )
        );
      });

      req.on("error", (error) => finish(reject, networkError(error, device)));

      if (payload !== undefined) {
        req.write(payload);
      }
      req.end();
    });
  }

  close() {
    for (const agent of this.agents.values()) {
      agent.destroy();
    }
    this.agents.clear();
    this.cache.clear();
    this.lastRequestAt.clear();
  }
}
