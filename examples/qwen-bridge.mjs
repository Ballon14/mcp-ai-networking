#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../src/server.mjs", import.meta.url));

const SYSTEM_PROMPT = [
  "Anda adalah asisten jaringan untuk perangkat MikroTik RouterOS v7.",
  "Anda hanya memiliki tool read-only. Selalu panggil tool untuk membaca kondisi nyata sebelum menjawab.",
  "Jangan mengarang data perangkat. Jika tool gagal, jelaskan penyebab dan langkah perbaikannya.",
  "Jika hasil tool menyatakan truncated, persempit query memakai filter atau limit/offset.",
  "Jawab ringkas dalam bahasa pengguna dan sebutkan nama device yang dipakai."
].join(" ");

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--once") {
      options.once = argv[index + 1];
      index += 1;
    } else if (arg === "--model") {
      options.model = argv[index + 1];
      index += 1;
    } else if (arg === "--host") {
      options.host = argv[index + 1];
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (!options.once) {
      options.once = arg;
    }
  }
  return options;
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === "") return undefined;
  return value.toLowerCase() === "true";
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchJson(url, options = {}, timeoutMs = 120000) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(`Request ke ${url} melewati batas ${timeoutMs} ms.`);
    }
    throw new Error(`Tidak bisa terhubung ke ${url}: ${error.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} dari ${url}: ${text.slice(0, 400)}`);
  }
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Respons bukan JSON dari ${url}: ${text.slice(0, 200)}`);
  }
}

async function listModels(host, timeoutMs) {
  const body = await fetchJson(`${host}/api/tags`, {}, timeoutMs);
  return (body.models ?? []).map((model) => model.name).filter(Boolean);
}

function chooseModel(models, requestedModel) {
  if (requestedModel) {
    if (!models.includes(requestedModel)) {
      console.log(`Peringatan: model "${requestedModel}" tidak ada di daftar Ollama; tetap dicoba.`);
    }
    return requestedModel;
  }

  const preferred =
    models.find((name) => /qwen3\.5/i.test(name)) ??
    models.find((name) => /qwen/i.test(name)) ??
    models[0];

  if (!preferred) {
    throw new Error(
      "Tidak ada model di Ollama. Jalankan: ollama pull qwen3.5:4b (sesuaikan tag model Anda)."
    );
  }
  return preferred;
}

function toOllamaTools(tools) {
  return tools.map((tool) => {
    const parameters = structuredClone(
      tool.inputSchema ?? { type: "object", properties: {} }
    );
    delete parameters.$schema;
    if (!parameters.type) parameters.type = "object";
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

function normalizeToolArguments(args) {
  if (typeof args === "string") {
    if (args.trim() === "") return {};
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return args && typeof args === "object" ? args : {};
}

function toolResultText(result, maxChars) {
  const text = (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  const payload = result.isError ? `ERROR: ${text}` : text;
  if (payload.length <= maxChars) return payload;
  return `${payload.slice(0, maxChars)}\n... [dipotong oleh bridge; persempit query dengan filter/limit]`;
}

function trimHistory(messages, maxChars, maxMessages) {
  const totalChars = () =>
    messages.reduce((sum, message) => sum + JSON.stringify(message).length, 0);

  let start = 1;
  while (
    (messages.length - start > maxMessages || totalChars() > maxChars) &&
    start < messages.length - 1
  ) {
    const nextUserIndex = messages.findIndex(
      (message, index) => index > start && message.role === "user"
    );
    if (nextUserIndex === -1) break;
    start = nextUserIndex;
  }
  if (start > 1) {
    messages.splice(1, start - 1);
  }
}

async function ollamaChat({ host, model, messages, tools, timeoutMs, options, think }) {
  const body = {
    model,
    messages,
    tools,
    stream: false,
    options
  };
  if (think !== undefined) {
    body.think = think;
  }

  const data = await fetchJson(
    `${host}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    timeoutMs
  );

  if (!data.message) {
    throw new Error("Respons Ollama tidak memuat field message.");
  }
  return data.message;
}

async function runTurn({ question, messages, ollamaTools, mcpClient, config }) {
  messages.push({ role: "user", content: question });

  let finalAnswer = null;

  for (let turn = 0; turn < config.maxToolTurns; turn += 1) {
    const message = await ollamaChat({
      host: config.host,
      model: config.model,
      messages,
      tools: ollamaTools,
      timeoutMs: config.timeoutMs,
      options: config.modelOptions,
      think: config.think
    });

    const toolCalls = message.tool_calls ?? [];
    const assistantMessage = {
      role: "assistant",
      content: message.content ?? ""
    };
    if (message.thinking) {
      assistantMessage.thinking = message.thinking;
      if (config.showThinking) {
        console.log(`\n[thinking] ${message.thinking}`);
      }
    }
    if (toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls;
    }
    messages.push(assistantMessage);

    if (toolCalls.length === 0) {
      finalAnswer = message.content ?? "";
      break;
    }

    for (const call of toolCalls) {
      const name = call.function?.name;
      const args = normalizeToolArguments(call.function?.arguments);
      console.log(`  [tool] ${name} ${JSON.stringify(args)}`);

      let result;
      try {
        result = await mcpClient.callTool({ name, arguments: args });
      } catch (error) {
        result = { isError: true, content: [{ type: "text", text: error.message }] };
      }

      messages.push({
        role: "tool",
        tool_name: name,
        content: toolResultText(result, config.maxToolChars)
      });
    }
  }

  trimHistory(messages, config.maxHistoryChars, config.maxHistoryMessages);

  if (finalAnswer === null) {
    return "(Model berhenti setelah batas maksimum pemanggilan tool. Persempit pertanyaan atau naikkan QWEN_MAX_TOOL_TURNS.)";
  }
  return finalAnswer;
}

function printHelp() {
  console.log(`Usage: node examples/qwen-bridge.mjs [question] [--once question] [--model name] [--host url]

Environment:
  OLLAMA_HOST               default http://10.10.10.21:11434
  QWEN_MODEL                model tag; auto-detect qwen jika kosong
  QWEN_TIMEOUT_MS           default 120000
  QWEN_NUM_CTX              default 8192
  QWEN_THINK                true/false; kosong = default model
  QWEN_SHOW_THINKING        true untuk mencetak thinking
  QWEN_MAX_TOOL_TURNS       default 6
  QWEN_MAX_TOOL_CHARS       default 12000
  QWEN_MAX_HISTORY_CHARS    default 24000`);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const host = stripTrailingSlash(
    options.host ?? process.env.OLLAMA_HOST ?? "http://10.10.10.21:11434"
  );
  const timeoutMs = positiveNumber(process.env.QWEN_TIMEOUT_MS, 120000);

  let models;
  try {
    models = await listModels(host, Math.min(timeoutMs, 15000));
  } catch (error) {
    throw new Error(
      `${error.message}\n` +
        `Pastikan Ollama berjalan di ${host} dan dapat diakses dari mesin ini:\n` +
        "  - Di mesin Ollama set OLLAMA_HOST=0.0.0.0:11434 lalu restart Ollama agar bind ke semua interface.\n" +
        "  - Buka firewall TCP 11434 untuk host ini.\n" +
        `  - Uji: curl ${host}/api/tags`
    );
  }

  const model = chooseModel(models, options.model ?? process.env.QWEN_MODEL);
  const config = {
    host,
    model,
    timeoutMs,
    modelOptions: {
      temperature: 0.2,
      num_ctx: positiveNumber(process.env.QWEN_NUM_CTX, 8192)
    },
    think: parseOptionalBoolean(process.env.QWEN_THINK),
    showThinking: process.env.QWEN_SHOW_THINKING === "true",
    maxToolTurns: positiveNumber(process.env.QWEN_MAX_TOOL_TURNS, 6),
    maxToolChars: positiveNumber(process.env.QWEN_MAX_TOOL_CHARS, 12000),
    maxHistoryChars: positiveNumber(process.env.QWEN_MAX_HISTORY_CHARS, 24000),
    maxHistoryMessages: 24
  };

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env },
    cwd: process.cwd(),
    stderr: "inherit"
  });

  const mcpClient = new Client({ name: "mikrotik-qwen-bridge", version: "1.0.0" });
  await mcpClient.connect(transport);

  const rl = options.once ? null : readline.createInterface({ input, output });
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  try {
    const { tools } = await mcpClient.listTools();
    const ollamaTools = toOllamaTools(tools);

    console.log(`Ollama: ${host}`);
    console.log(`Model: ${model}`);
    console.log(`MCP tools read-only: ${tools.length}`);
    console.log('Ketik pertanyaan tentang jaringan Anda, atau "exit" untuk keluar.\n');

    if (options.once) {
      const answer = await runTurn({
        question: options.once,
        messages,
        ollamaTools,
        mcpClient,
        config
      });
      console.log(`\nAssistant: ${answer}`);
      return;
    }

    while (true) {
      let question;
      try {
        question = (await rl.question("You: ")).trim();
      } catch {
        break;
      }
      if (
        question === "" ||
        question.toLowerCase() === "exit" ||
        question.toLowerCase() === "quit"
      ) {
        break;
      }

      const answer = await runTurn({
        question,
        messages,
        ollamaTools,
        mcpClient,
        config
      });
      console.log(`\nAssistant: ${answer}\n`);
    }
  } finally {
    rl?.close();
    await mcpClient.close();
  }
}

main().catch((error) => {
  console.error(`Qwen bridge failed: ${error.message}`);
  process.exit(1);
});
