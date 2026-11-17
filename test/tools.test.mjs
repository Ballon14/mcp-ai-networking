import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RouterOsClient } from "../src/routeros/client.mjs";
import { registerTools } from "../src/tools/index.mjs";
import { startMockRouteros } from "./helpers/mock-routeros.mjs";
import { createFixtures } from "./helpers/fixtures.mjs";
import { testConfig } from "./helpers/test-config.mjs";

const EXPECTED_TOOLS = [
  "get_dhcp_leases",
  "get_dns_config",
  "get_firewall_rules",
  "get_logs",
  "get_routes",
  "get_wireless_clients",
  "list_devices",
  "list_interfaces",
  "ping",
  "system_info"
];

async function setup(t, mockOptions = {}) {
  const fixtures = mockOptions.fixtures ?? createFixtures();
  const mock = await startMockRouteros({ ...mockOptions, fixtures });
  const config = testConfig(mock.port, mockOptions.deviceOverrides ?? {});
  const rosClient = new RouterOsClient(config);

  const mcpServer = new McpServer({ name: "mikrotik-mcp-test", version: "0.0.0" });
  registerTools(mcpServer, { config, client: rosClient });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
  await mcpClient.connect(clientTransport);

  t.after(async () => {
    await mcpClient.close().catch(() => {});
    await mcpServer.close().catch(() => {});
    rosClient.close();
    await mock.close();
  });

  return { mock, config, mcpClient };
}

function payloadOf(result) {
  assert.notEqual(
    result.isError,
    true,
    `tool returned an error: ${result.content?.map((item) => item.text).join("\n")}`
  );
  const text = result.content.find((item) => item.type === "text")?.text;
  assert.ok(text, "tool result must contain text content");
  return JSON.parse(text);
}

test("exposes only read-only tools with readOnlyHint", async (t) => {
  const { mcpClient } = await setup(t);

  const { tools } = await mcpClient.listTools();
  const names = tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, EXPECTED_TOOLS);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be read-only`);
    assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} must not be destructive`);
  }

  const writeLike = /(set|add|remove|reboot|write|apply|delete|create|update)/i;
  for (const name of names) {
    assert.ok(!writeLike.test(name), `unexpected write-like tool: ${name}`);
  }
});

test("system_info returns identity and normalized resources", async (t) => {
  const { mcpClient } = await setup(t);

  const payload = payloadOf(await mcpClient.callTool({ name: "system_info", arguments: {} }));

  assert.equal(payload.device, "core");
  assert.equal(payload.identity.name, "mock-router");
  assert.equal(payload.resource.version, "7.16.2 (stable)");
  assert.equal(payload.resource["cpu-load"], 7);
  assert.equal(payload.resource["cpu-count"], 4);
  assert.equal(payload.resource["memory-used-percent"], 25);
});

test("list_devices does not expose passwords", async (t) => {
  const { mcpClient } = await setup(t);

  const payload = payloadOf(await mcpClient.callTool({ name: "list_devices", arguments: {} }));

  assert.equal(payload.defaultDevice, "core");
  assert.equal(payload.devices.length, 1);
  assert.equal(payload.devices[0].default, true);
  assert.ok(!JSON.stringify(payload).includes("test-pass"));
});

test("list_interfaces filters, converts counters and paginates", async (t) => {
  const { mcpClient } = await setup(t);

  const all = payloadOf(await mcpClient.callTool({ name: "list_interfaces", arguments: {} }));
  assert.equal(all.total, 3);
  assert.equal(all.running, 2);
  assert.equal(all.interfaces[0]["rx-byte"], 1000);

  const running = payloadOf(
    await mcpClient.callTool({ name: "list_interfaces", arguments: { runningOnly: true } })
  );
  assert.equal(running.total, 2);

  const named = payloadOf(
    await mcpClient.callTool({ name: "list_interfaces", arguments: { name: "ETHER" } })
  );
  assert.equal(named.total, 2);

  const page = payloadOf(
    await mcpClient.callTool({ name: "list_interfaces", arguments: { limit: 1, offset: 1 } })
  );
  assert.equal(page.interfaces.length, 1);
  assert.equal(page.offset, 1);
  assert.equal(page.truncated, true);
});

test("get_routes filters by type and destination", async (t) => {
  const { mcpClient } = await setup(t);

  const staticRoutes = payloadOf(
    await mcpClient.callTool({ name: "get_routes", arguments: { type: "static" } })
  );
  assert.equal(staticRoutes.total, 2);

  const connected = payloadOf(
    await mcpClient.callTool({ name: "get_routes", arguments: { type: "connected" } })
  );
  assert.equal(connected.total, 1);

  const dynamic = payloadOf(
    await mcpClient.callTool({ name: "get_routes", arguments: { type: "dynamic" } })
  );
  assert.equal(dynamic.total, 1);

  const dst = payloadOf(
    await mcpClient.callTool({ name: "get_routes", arguments: { dst: "10.10" } })
  );
  assert.equal(dst.total, 1);
  assert.equal(dst.routes[0]["dst-address"], "10.10.10.0/24");
});

test("get_firewall_rules filters by chain and never returns secrets", async (t) => {
  const { mcpClient } = await setup(t);

  const filter = payloadOf(
    await mcpClient.callTool({ name: "get_firewall_rules", arguments: { table: "filter" } })
  );
  assert.equal(filter.total, 3);

  const serialized = JSON.stringify(filter);
  assert.ok(!serialized.includes("hunter2"));
  assert.ok(!serialized.includes("should-be-redacted"));

  const inputChain = payloadOf(
    await mcpClient.callTool({
      name: "get_firewall_rules",
      arguments: { table: "filter", chain: "input" }
    })
  );
  assert.equal(inputChain.total, 2);

  const addressList = payloadOf(
    await mcpClient.callTool({
      name: "get_firewall_rules",
      arguments: { table: "address-list" }
    })
  );
  assert.equal(addressList.rules[0].list, "blocked");
});

test("get_dhcp_leases filters by status and search term", async (t) => {
  const { mcpClient } = await setup(t);

  const bound = payloadOf(
    await mcpClient.callTool({ name: "get_dhcp_leases", arguments: { status: "BOUND" } })
  );
  assert.equal(bound.total, 1);
  assert.equal(bound.bound, 1);

  const search = payloadOf(
    await mcpClient.callTool({ name: "get_dhcp_leases", arguments: { search: "print" } })
  );
  assert.equal(search.total, 1);
  assert.equal(search.leases[0]["host-name"], "printer");
});

test("get_dns_config returns config and optional static entries", async (t) => {
  const { mcpClient } = await setup(t);

  const configOnly = payloadOf(
    await mcpClient.callTool({ name: "get_dns_config", arguments: {} })
  );
  assert.equal(configOnly.config.servers, "1.1.1.1,8.8.8.8");
  assert.equal(configOnly.static, undefined);

  const withStatic = payloadOf(
    await mcpClient.callTool({
      name: "get_dns_config",
      arguments: { includeStatic: true }
    })
  );
  assert.equal(withStatic.static.entries.length, 1);
  assert.equal(withStatic.static.entries[0].name, "router.lan");
});

test("get_wireless_clients falls back to the legacy registration table", async (t) => {
  const { mcpClient } = await setup(t);

  const payload = payloadOf(
    await mcpClient.callTool({ name: "get_wireless_clients", arguments: {} })
  );

  assert.equal(payload.source, "wireless");
  assert.equal(payload.total, 1);
  assert.equal(payload.clients[0].ssid, "lab");
});

test("get_logs filters topics, redacts messages and truncates", async (t) => {
  const { mcpClient } = await setup(t);

  const system = payloadOf(
    await mcpClient.callTool({ name: "get_logs", arguments: { topics: ["system"] } })
  );
  assert.equal(system.total, 2);
  assert.ok(!JSON.stringify(system).includes("supersecret"));
  assert.ok(JSON.stringify(system).includes("password=[REDACTED]"));

  const dhcp = payloadOf(
    await mcpClient.callTool({ name: "get_logs", arguments: { topics: ["dhcp"] } })
  );
  assert.equal(dhcp.total, 1);

  const limited = payloadOf(
    await mcpClient.callTool({ name: "get_logs", arguments: { limit: 1 } })
  );
  assert.equal(limited.entries.length, 1);
  assert.equal(limited.truncated, true);
});

test("ping calls the allowlisted REST command and summarizes replies", async (t) => {
  const { mcpClient, mock } = await setup(t);

  const payload = payloadOf(
    await mcpClient.callTool({
      name: "ping",
      arguments: { address: "1.1.1.1", count: 3 }
    })
  );

  assert.equal(payload.stats.sent, 3);
  assert.equal(payload.stats.received, 2);
  assert.equal(payload.stats.packetLoss, "33%");
  assert.equal(payload.replies.length, 4);

  const pingRequest = mock.requests.find((request) => request.url === "/rest/ping");
  assert.equal(pingRequest.method, "POST");
  assert.deepEqual(JSON.parse(pingRequest.body), { address: "1.1.1.1", count: "3" });
});

test("unknown device names produce a helpful tool error", async (t) => {
  const { mcpClient } = await setup(t);

  const result = await mcpClient.callTool({
    name: "system_info",
    arguments: { device: "does-not-exist" }
  });

  assert.equal(result.isError, true);
  const text = result.content.map((item) => item.text).join("\n");
  assert.ok(text.includes("Unknown device"));
  assert.ok(text.includes("core"));
});

test("ping permission errors mention the test policy", async (t) => {
  const { mcpClient } = await setup(t, {
    fixtures: { ...createFixtures(), "POST /rest/ping": undefined },
    forbidden: new Set(["POST /rest/ping"])
  });

  const result = await mcpClient.callTool({
    name: "ping",
    arguments: { address: "1.1.1.1", count: 1 }
  });

  assert.equal(result.isError, true);
  const text = result.content.map((item) => item.text).join("\n");
  assert.ok(text.includes("test") && text.includes("policy"));
});
