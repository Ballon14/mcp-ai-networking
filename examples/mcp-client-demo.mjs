#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../src/server.mjs", import.meta.url));

function parseJsonArg(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Arguments must be valid JSON: ${error.message}`);
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env },
    cwd: process.cwd(),
    stderr: "inherit"
  });

  const client = new Client({ name: "mikrotik-mcp-demo", version: "1.0.0" });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    console.log(`Connected to ${serverPath}`);
    console.log(`Tools (${tools.length}):`);
    for (const tool of tools) {
      console.log(`- ${tool.name}: ${tool.description ?? ""}`);
    }

    const requestedTool = process.argv[2];
    const requestedArgs = parseJsonArg(process.argv[3]);

    if (requestedTool) {
      const result = await client.callTool({
        name: requestedTool,
        arguments: requestedArgs
      });
      console.log(`\nResult of ${requestedTool}:`);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const devices = await client.callTool({ name: "list_devices", arguments: {} });
    console.log("\nConfigured devices:");
    console.log(devices.content.map((item) => item.text).join("\n"));

    const systemInfo = await client.callTool({ name: "system_info", arguments: {} });
    console.log("\nDefault device system info:");
    console.log(systemInfo.content.map((item) => item.text).join("\n"));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Demo failed: ${error.message}`);
  process.exit(1);
});
