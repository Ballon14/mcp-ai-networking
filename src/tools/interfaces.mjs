import { z } from "zod";
import { jsonResult, toolHandler } from "../lib/result.mjs";
import { asArray, matchesSearch, pickFields, toBoolean, toNumber } from "../lib/normalize.mjs";
import { pageRows, pagingNote } from "../lib/truncate.mjs";
import { deviceParam, readOnlyAnnotations, resolveDevice } from "./common.mjs";

const INTERFACE_FIELDS = [
  "name",
  "type",
  "mtu",
  "actual-mtu",
  "running",
  "disabled",
  "comment",
  "mac-address",
  "last-link-up-time",
  "link-downs",
  "rx-byte",
  "tx-byte",
  "rx-packet",
  "tx-packet",
  "rx-error",
  "tx-error"
];

export function registerInterfaceTools(server, context) {
  server.registerTool(
    "list_interfaces",
    {
      title: "List MikroTik interfaces",
      description:
        "List interfaces (ethernet, bridge, vlan, wireless, tunnels) with run state, MTU, MAC address and traffic counters. Filter by name or only show running interfaces.",
      inputSchema: {
        device: deviceParam,
        name: z
          .string()
          .min(1)
          .optional()
          .describe("Case-insensitive substring filter on the interface name."),
        runningOnly: z
          .boolean()
          .default(false)
          .describe("Only return interfaces that are currently running (not disabled/down)."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum rows to return."),
        offset: z.number().int().min(0).optional().describe("Rows to skip, for pagination.")
      },
      annotations: readOnlyAnnotations
    },
    toolHandler(async ({ device, name, runningOnly, limit, offset }) => {
      const target = resolveDevice(context, device);
      const data = asArray(await context.client.get(target, "/rest/interface"));

      let rows = data;
      if (name) {
        rows = rows.filter((row) => matchesSearch(row, name, ["name"]));
      }
      if (runningOnly) {
        rows = rows.filter((row) => toBoolean(row.running));
      }

      const page = pageRows(
        rows.map((row) => pickFields(row, INTERFACE_FIELDS)),
        { limit, offset },
        { defaultLimit: context.config.maxRows, maxLimit: 500 }
      );

      const running = rows.filter((row) => toBoolean(row.running)).length;

      return jsonResult({
        summary: `${pagingNote(page, "Interfaces")} ${running} of ${rows.length} matching interfaces are running.`,
        device: target.name,
        total: page.total,
        running,
        offset: page.offset,
        limit: page.limit,
        truncated: page.truncated,
        interfaces: page.rows.map((row) => ({
          ...row,
          "rx-byte": toNumber(row["rx-byte"]),
          "tx-byte": toNumber(row["tx-byte"])
        }))
      });
    })
  );
}
