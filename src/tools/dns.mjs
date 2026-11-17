import { z } from "zod";
import { jsonResult, toolHandler } from "../lib/result.mjs";
import { asArray, firstObject, pickFields } from "../lib/normalize.mjs";
import { pageRows, pagingNote } from "../lib/truncate.mjs";
import { deviceParam, readOnlyAnnotations, resolveDevice } from "./common.mjs";

const DNS_FIELDS = [
  "servers",
  "dynamic-servers",
  "use-doh-server",
  "verify-doh-cert",
  "allow-remote-requests",
  "cache-size",
  "cache-used",
  "cache-max-ttl"
];

const STATIC_FIELDS = [".id", "name", "address", "type", "ttl", "comment", "disabled", "dynamic"];

export function registerDnsTools(server, context) {
  server.registerTool(
    "get_dns_config",
    {
      title: "Get MikroTik DNS configuration",
      description:
        "Read DNS settings (static and dynamic servers, DoH, remote requests, cache usage) and optionally the static DNS entries.",
      inputSchema: {
        device: deviceParam,
        includeStatic: z
          .boolean()
          .default(false)
          .describe("Also return /ip/dns/static entries."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum static rows to return."),
        offset: z.number().int().min(0).optional().describe("Static rows to skip, for pagination.")
      },
      annotations: readOnlyAnnotations
    },
    toolHandler(async ({ device, includeStatic, limit, offset }) => {
      const target = resolveDevice(context, device);
      const configData = firstObject(await context.client.get(target, "/rest/ip/dns"));
      const config = pickFields(configData, DNS_FIELDS);

      const payload = {
        summary: `DNS configuration for "${target.name}" read successfully.`,
        device: target.name,
        config
      };

      if (includeStatic) {
        const staticData = asArray(await context.client.get(target, "/rest/ip/dns/static"));
        const page = pageRows(
          staticData.map((row) => pickFields(row, STATIC_FIELDS)),
          { limit, offset },
          { defaultLimit: context.config.maxRows, maxLimit: 500 }
        );
        payload.summary = `${pagingNote(page, "Static DNS entries")} DNS servers: ${config.servers || "(none)"}.`;
        payload.static = {
          total: page.total,
          offset: page.offset,
          limit: page.limit,
          truncated: page.truncated,
          entries: page.rows
        };
      }

      return jsonResult(payload);
    })
  );
}
