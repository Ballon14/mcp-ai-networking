import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigError, loadConfig } from "../src/config.mjs";

function writeConfigFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ai-config-"));
  const file = path.join(dir, "mikrotik.config.json");
  fs.writeFileSync(file, JSON.stringify(contents), "utf8");
  return file;
}

function baseDevice(overrides = {}) {
  return {
    name: "core",
    host: "192.168.88.1",
    user: "mcp-read",
    passwordEnv: "ROS_CORE_PASS",
    tls: true,
    insecure: false,
    ...overrides
  };
}

test("loads config and resolves the password from the environment", () => {
  const configPath = writeConfigFile({
    maxRows: 100,
    devices: [baseDevice()]
  });

  const config = loadConfig({
    configPath,
    env: { ROS_CORE_PASS: "secret-from-env" }
  });

  assert.equal(config.defaultDevice, "core");
  assert.equal(config.maxRows, 100);
  assert.equal(config.devices[0].port, 443);
  assert.equal(config.devices[0].baseUrl, "https://192.168.88.1:443");
  assert.equal(config.devices[0].password, "secret-from-env");
  assert.equal(config.devices[0].timeoutMs, 10000);
  assert.equal(config.devices[0].minIntervalMs, 250);
  assert.ok(!JSON.stringify(config).includes("secret-from-env"));
});

test("environment password takes precedence over the config password", () => {
  const configPath = writeConfigFile({
    devices: [baseDevice({ password: "file-password" })]
  });

  const config = loadConfig({
    configPath,
    env: { ROS_CORE_PASS: "env-password" }
  });

  assert.equal(config.devices[0].password, "env-password");
});

test("fails with a helpful message when the password env var is missing", () => {
  const configPath = writeConfigFile({ devices: [baseDevice()] });

  assert.throws(
    () => loadConfig({ configPath, env: {} }),
    (error) => error instanceof ConfigError && error.message.includes("ROS_CORE_PASS")
  );
});

test("rejects duplicate device names", () => {
  const configPath = writeConfigFile({
    devices: [baseDevice(), baseDevice({ host: "192.168.88.2" })]
  });

  assert.throws(
    () => loadConfig({ configPath, env: { ROS_CORE_PASS: "secret" } }),
    (error) => error instanceof ConfigError && error.message.includes("duplicate device name")
  );
});

test("rejects an unknown defaultDevice", () => {
  const configPath = writeConfigFile({
    defaultDevice: "missing",
    devices: [baseDevice()]
  });

  assert.throws(
    () => loadConfig({ configPath, env: { ROS_CORE_PASS: "secret" } }),
    (error) => error instanceof ConfigError && error.message.includes("defaultDevice")
  );
});

test("defaults to the first device when defaultDevice is omitted", () => {
  const configPath = writeConfigFile({
    devices: [baseDevice({ name: "first" }), baseDevice({ name: "second" })]
  });

  const config = loadConfig({
    configPath,
    env: { ROS_CORE_PASS: "secret" }
  });

  assert.equal(config.defaultDevice, "first");
});

test("fails with a clear message when the config file does not exist", () => {
  assert.throws(
    () => loadConfig({ configPath: path.join(os.tmpdir(), "missing-config.json") }),
    (error) => error instanceof ConfigError && error.message.includes("not found")
  );
});
