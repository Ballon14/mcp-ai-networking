import { z } from "zod";
import { jsonResult, toolHandler } from "../lib/result.mjs";
import { asArray, pickFields } from "../lib/normalize.mjs";
import { redactText } from "../lib/redact.mjs";
import { pageRows, pagingNote } from "../lib/truncate.mjs";
import { deviceParam, readOnlyAnnotations, resolveDevice } from "./common.mjs";

const LOG_FIELDS = [".id", "time", "topics", "message"];

function matchesTopics(row, topics) {
  if (!topics || topics.length === 0) return true;
  const rowTopics = String(row.topics ?? "")
    .split(/[,;]\s*/)
    .map((topic) => topic.trim().toLowerCase())
    .filter(Boolean);
  return topics.some((topic) => rowTopics.includes(topic.toLowerCase()));
}

export function registerLogTools(server, context) {
  server.registerTool(
    "get_logs",
    {
      title: "Get MikroTik logs",
      description:
        "Read recent log entries with time, topics and message. Filter by one or more RouterOS log topics such as system, dhcp, firewall or wireless. Messages are redacted for common secret patterns.",
      inputSchema: {
        device: deviceParam,
        topics: z
          .array(z.string().min(1))
          .optional()
          .describe("Only return entries containing any of these topics (for example [\"system\",\"firewall\"])."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum rows to return (default 50)."),
        offset: z.number().int().min(0).optional().describe("Rows to skip, for pagination.")
      },
      annotations: readOnlyAnnotations
    },
    toolHandler(async ({ device, topics, limit, offset }) => {
      const target = resolveDevice(context, device);
      const data = asArray(await context.client.get(target, "/rest/log"));

      let rows = data;
      if (topics && topics.length > 0) {
        rows = rows.filter((row) => matchesTopics(row, topics));
      }

      const page = pageRows(
        rows.map((row) => {
          const picked = pickFields(row, LOG_FIELDS);
          if (picked.message !== undefined) {
            picked.message = redactText(String(picked.message));
          }
          return picked;
        }),
        { limit, offset },
        { defaultLimit: 50, maxLimit: 500 }
      );

      return jsonResult({
        summary: pagingNote(page, `Log entries on "${target.name}"`),
        device: target.name,
        topics: topics ?? [],
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        truncated: page.truncated,
        entries: page.rows
      });
    })
  );
}
