#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../src/server.mjs", import.meta.url));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const MAX_TOOL_TURNS = 8;

const SYSTEM_PROMPT = [
  "You are a network assistant for MikroTik RouterOS v7 devices.",
  "You only have read-only tools: inspect the real router state before answering.",
  "When a result says it is truncated, narrow the query with filters instead of dumping everything.",
  "Never invent device data. If access fails, explain what configuration or RouterOS policy is missing.",
  "Answer in the language the user writes in."
].join(" ");

function toOpenAITools(tools) {
  return tools.map((tool) => {
    const parameters = structuredClone(tool.inputSchema ?? { type: "object", properties: {} });
    delete parameters.$schema;
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description ?? "",
        parameters
      }
    };
  });
}

function toolResultText(result) {
  const text = (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  return result.isError ? `ERROR: ${text}` : text;
}

async function chatCompletion(messages, tools) {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      tools,
      tool_choice: "auto"
    })
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`OpenAI API returned HTTP ${response.status}: ${body}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("OpenAI API returned no choices");
  }
  return message;
}

function parseToolArguments(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

async function main() {
  if (!OPENAI_API_KEY) {
    throw new Error("Set OPENAI_API_KEY before running the bridge.");
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env },
    cwd: process.cwd(),
    stderr: "inherit"
  });

  const mcpClient = new Client({ name: "mikrotik-openai-bridge", version: "1.0.0" });
  await mcpClient.connect(transport);

  const rl = readline.createInterface({ input, output });
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  try {
    const { tools } = await mcpClient.listTools();
    const openaiTools = toOpenAITools(tools);
    console.log(`Connected to ${tools.length} read-only MikroTik tools via MCP. Model: ${OPENAI_MODEL}`);
    console.log('Type a question about your network, or "exit" to quit.\n');

    while (true) {
      let userInput;
      try {
        userInput = (await rl.question("You: ")).trim();
      } catch {
        break;
      }
      if (userInput === "" || userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
        break;
      }

      messages.push({ role: "user", content: userInput });

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
        const message = await chatCompletion(messages, openaiTools);
        const toolCalls = message.tool_calls ?? [];
        const assistantMessage = {
          role: "assistant",
          content: message.content ?? null
        };
        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }
        messages.push(assistantMessage);

        if (toolCalls.length === 0) {
          console.log(`\nAssistant: ${message.content ?? "(no content)"}\n`);
          break;
        }

        for (const call of toolCalls) {
          const name = call.function?.name;
          const args = parseToolArguments(call.function?.arguments);
          console.log(`  [tool] ${name} ${JSON.stringify(args)}`);

          let result;
          try {
            result = await mcpClient.callTool({ name, arguments: args });
          } catch (error) {
            result = { isError: true, content: [{ type: "text", text: error.message }] };
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: toolResultText(result)
          });
        }

        if (turn === MAX_TOOL_TURNS - 1) {
          console.log("\nAssistant: stopped after the maximum number of tool turns.\n");
        }
      }
    }
  } finally {
    rl.close();
    await mcpClient.close();
  }
}

main().catch((error) => {
  console.error(`Bridge failed: ${error.message}`);
  process.exit(1);
});
