import { z } from "zod";
import { jsonResult, toolHandler } from "../lib/result.mjs";
import { asArray, pickFields } from "../lib/normalize.mjs";
import { redactObject } from "../lib/redact.mjs";
import { pageRows, pagingNote } from "../lib/truncate.mjs";
import { deviceParam, readOnlyAnnotations, resolveDevice } from "./common.mjs";

const TABLE_PATHS = {
  filter: "/rest/ip/firewall/filter",
  nat: "/rest/ip/firewall/nat",
  mangle: "/rest/ip/firewall/mangle",
  "address-list": "/rest/ip/firewall/address-list"
};

const TABLE_FIELDS = {
  filter: [
    ".id",
    "chain",
    "action",
    "jump-target",
    "protocol",
    "src-address",
    "dst-address",
    "src-port",
    "dst-port",
    "in-interface",
    "out-interface",
    "in-interface-list",
    "out-interface-list",
    "connection-state",
    "comment",
    "disabled",
    "dynamic",
    "log"
  ],
  nat: [
    ".id",
    "chain",
    "action",
    "protocol",
    "src-address",
    "dst-address",
    "src-port",
    "dst-port",
    "out-interface",
    "to-addresses",
    "to-ports",
    "comment",
    "disabled",
    "dynamic",
    "log"
  ],
  mangle: [
    ".id",
    "chain",
    "action",
    "protocol",
    "src-address",
    "dst-address",
    "in-interface",
    "out-interface",
    "new-connection-mark",
    "new-routing-mark",
    "new-packet-mark",
    "passthrough",
    "comment",
    "disabled"
  ],
  "address-list": [".id", "list", "address", "timeout", "dynamic", "disabled", "comment"]
};

export function registerFirewallTools(server, context) {
  server.registerTool(
    "get_firewall_rules",
    {
      title: "Get MikroTik firewall rules",
      description:
        "Read IPv4 firewall filter, NAT, mangle or address-list entries in router order. Optionally filter by chain. Large tables are truncated; use limit/offset to page through them.",
      inputSchema: {
        device: deviceParam,
        table: z
          .enum(["filter", "nat", "mangle", "address-list"])
          .default("filter")
          .describe("Firewall table to read."),
        chain: z
          .string()
          .min(1)
          .optional()
          .describe("Case-insensitive exact chain filter (filter/nat/mangle only)."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum rows to return."),
        offset: z.number().int().min(0).optional().describe("Rows to skip, for pagination.")
      },
      annotations: readOnlyAnnotations
    },
    toolHandler(async ({ device, table, chain, limit, offset }) => {
      const target = resolveDevice(context, device);
      const data = asArray(await context.client.get(target, TABLE_PATHS[table]));

      let rows = data;
      if (chain && table !== "address-list") {
        const wanted = chain.toLowerCase();
        rows = rows.filter((row) => String(row.chain ?? "").toLowerCase() === wanted);
      }

      const page = pageRows(
        rows.map((row) => redactObject(pickFields(row, TABLE_FIELDS[table]))),
        { limit, offset },
        { defaultLimit: context.config.maxRows, maxLimit: 500 }
      );

      return jsonResult({
        summary: pagingNote(page, `Firewall ${table} rules on "${target.name}"`),
        device: target.name,
        table,
        chain: chain ?? null,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        truncated: page.truncated,
        rules: page.rows
      });
    })
  );
}
