export function testConfig(port, overrides = {}) {
  const device = {
    name: "core",
    host: "127.0.0.1",
    port,
    user: "mcp-read",
    password: "test-pass",
    tls: false,
    insecure: false,
    timeoutMs: 2000,
    minIntervalMs: 0,
    baseUrl: `http://127.0.0.1:${port}`,
    ...overrides
  };
  if (overrides.port !== undefined) {
    device.baseUrl = `${overrides.tls ? "https" : "http"}://${device.host}:${overrides.port}`;
  }
  return {
    defaultDevice: device.name,
    maxRows: 200,
    devices: [device]
  };
}
