import { test } from "node:test";
import assert from "node:assert/strict";
import { RouterOsClient } from "../src/routeros/client.mjs";
import { ReadOnlyViolationError } from "../src/routeros/errors.mjs";
import { startMockRouteros } from "./helpers/mock-routeros.mjs";
import { testConfig } from "./helpers/test-config.mjs";

async function setup(t, mockOptions = {}, clientOverrides = {}) {
  const mock = await startMockRouteros(mockOptions);
  t.after(() => mock.close());

  const config = testConfig(mock.port, clientOverrides);
  const client = new RouterOsClient(config);
  t.after(() => client.close());

  return { mock, config, client, device: config.devices[0] };
}

test("sends basic auth and returns parsed JSON", async (t) => {
  const { mock, client, device } = await setup(t, {
    fixtures: { "/rest/system/identity": { name: "mock-router" } }
  });

  const data = await client.get(device, "/rest/system/identity");

  assert.deepEqual(data, { name: "mock-router" });
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].method, "GET");
  assert.match(mock.requests[0].auth, /^Basic /);
});

test("blocks non-GET methods in read-only mode", async (t) => {
  const { client, device } = await setup(t, {
    fixtures: { "/rest/ip/route": [] }
  });

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await assert.rejects(
      () => client.request(device, "/rest/ip/route", { method }),
      (error) =>
        error instanceof ReadOnlyViolationError &&
        error.message.includes("Read-only mode")
    );
  }
});

test("blocks POST to any path outside the read-only allowlist", async (t) => {
  const { client, device } = await setup(t, {
    fixtures: { "/rest/system/reboot": [] }
  });

  await assert.rejects(
    () => client.request(device, "/rest/system/reboot", { method: "POST" }),
    ReadOnlyViolationError
  );
});

test("allows the allowlisted read-only ping command", async (t) => {
  const { mock, client, device } = await setup(t, {
    fixtures: {
      "POST /rest/ping": [{ seq: "0", host: "1.1.1.1", time: "10ms" }]
    }
  });

  const data = await client.request(device, "/rest/ping", {
    method: "POST",
    body: { address: "1.1.1.1", count: "1" }
  });

  assert.equal(data.length, 1);
  assert.equal(mock.requests[0].method, "POST");
  assert.deepEqual(JSON.parse(mock.requests[0].body), {
    address: "1.1.1.1",
    count: "1"
  });
});

test("maps 401 responses to a friendly authentication error", async (t) => {
  const mock = await startMockRouteros({ password: "different-pass" });
  t.after(() => mock.close());

  const config = testConfig(mock.port);
  const client = new RouterOsClient(config);
  t.after(() => client.close());

  await assert.rejects(
    () => client.get(config.devices[0], "/rest/system/identity"),
    (error) => error.status === 401 && error.message.includes("Authentication failed")
  );
});

test("maps 403 responses to a policy hint", async (t) => {
  const { client, device } = await setup(t, {
    fixtures: { "/rest/ip/route": [] },
    forbidden: new Set(["/rest/ip/route"])
  });

  await assert.rejects(
    () => client.get(device, "/rest/ip/route"),
    (error) => error.status === 403 && error.message.includes("rest-api")
  );
});

test("times out slow requests", async (t) => {
  const mock = await startMockRouteros({
    fixtures: { "/rest/system/resource": [{ version: "7.16.2" }] },
    delayMs: 300
  });
  t.after(() => mock.close());

  const config = testConfig(mock.port, { timeoutMs: 50 });
  const client = new RouterOsClient(config);
  t.after(() => client.close());

  await assert.rejects(
    () => client.get(config.devices[0], "/rest/system/resource"),
    (error) => error.code === "ETIMEDOUT" && error.message.includes("timed out")
  );
});

test("caches GET responses when a TTL is provided", async (t) => {
  const { mock, client, device } = await setup(t, {
    fixtures: { "/rest/system/resource": [{ version: "7.16.2" }] }
  });

  const first = await client.get(device, "/rest/system/resource", { cacheTtlMs: 5000 });
  const second = await client.get(device, "/rest/system/resource", { cacheTtlMs: 5000 });

  assert.deepEqual(first, second);
  assert.equal(mock.requests.length, 1);
});
