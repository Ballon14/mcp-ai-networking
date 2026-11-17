#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.mjs";
import { RouterOsClient } from "./routeros/client.mjs";
import { registerTools } from "./tools/index.mjs";

const SERVER_NAME = "mikrotik-mcp";
const SERVER_VERSION = "1.0.0";

async function main() {
  const config = loadConfig();
  const client = new RouterOsClient(config);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerTools(server, { config, client });

  const shutdown = async () => {
    client.close();
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[${SERVER_NAME}] ready: ${config.devices.length} device(s) configured, default "${config.defaultDevice}". Read-only mode.`
  );
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal: ${error.message}`);
  process.exit(1);
});
