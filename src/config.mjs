import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export class ConfigError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ConfigError";
  }
}

const DeviceSchema = z
  .object({
    name: z.string().trim().min(1, "device name must not be empty"),
    host: z.string().trim().min(1, "host must not be empty"),
    port: z.coerce.number().int().positive().max(65535).optional(),
    user: z.string().trim().min(1, "user must not be empty"),
    passwordEnv: z.string().trim().min(1).optional(),
    password: z.string().optional(),
    tls: z.boolean().default(true),
    insecure: z.boolean().default(false),
    timeoutMs: z.number().int().positive().max(60000).default(10000),
    minIntervalMs: z.number().int().min(0).max(10000).default(250)
  })
  .superRefine((device, ctx) => {
    if (!device.passwordEnv && device.password === undefined) {
      ctx.addIssue({
        code: "custom",
        message: `device "${device.name}" requires passwordEnv (recommended) or password`
      });
    }
    if (!device.tls && device.insecure) {
      ctx.addIssue({
        code: "custom",
        message: `device "${device.name}" sets insecure without tls`
      });
    }
  });

const ConfigSchema = z
  .object({
    defaultDevice: z.string().trim().min(1).optional(),
    maxRows: z.number().int().positive().max(5000).default(200),
    devices: z.array(DeviceSchema).min(1, "at least one device is required")
  })
  .superRefine((config, ctx) => {
    const seen = new Set();
    for (const device of config.devices) {
      if (seen.has(device.name)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate device name "${device.name}"`
        });
      }
      seen.add(device.name);
    }
    if (config.defaultDevice && !seen.has(config.defaultDevice)) {
      ctx.addIssue({
        code: "custom",
        message: `defaultDevice "${config.defaultDevice}" is not defined in devices`
      });
    }
  });

function formatIssues(error) {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "config"}: ${issue.message}`)
    .join("; ");
}

function normalizeHostForUrl(host) {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
}

export function loadConfig(options = {}) {
  const env = options.env ?? process.env;
  const configPath = path.resolve(
    options.configPath ?? env.MIKROTIK_CONFIG ?? "mikrotik.config.json"
  );

  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ConfigError(
        `Config file not found: ${configPath}. Copy mikrotik.config.example.json to mikrotik.config.json and fill in your devices.`
      );
    }
    throw new ConfigError(`Cannot read config file ${configPath}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`Invalid JSON in ${configPath}: ${error.message}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Invalid config ${configPath}: ${formatIssues(result.error)}`);
  }

  const config = result.data;
  for (const device of config.devices) {
    const fromEnv = device.passwordEnv ? env[device.passwordEnv] : undefined;
    const password = fromEnv ?? device.password;
    if (password === undefined || password === "") {
      throw new ConfigError(
        `Missing password for device "${device.name}". Set environment variable ${device.passwordEnv}.`
      );
    }

    const port = device.port ?? (device.tls ? 443 : 80);
    Object.defineProperty(device, "password", {
      value: password,
      enumerable: false,
      writable: false,
      configurable: true
    });
    Object.defineProperty(device, "port", {
      value: port,
      enumerable: true,
      writable: false,
      configurable: true
    });
    Object.defineProperty(device, "baseUrl", {
      value: `${device.tls ? "https" : "http"}://${normalizeHostForUrl(device.host)}:${port}`,
      enumerable: true,
      writable: false,
      configurable: true
    });
  }

  if (!config.defaultDevice) {
    config.defaultDevice = config.devices[0].name;
  }

  return config;
}

export function publicDeviceInfo(device) {
  return {
    name: device.name,
    host: device.host,
    port: device.port,
    tls: device.tls,
    insecure: device.insecure
  };
}
