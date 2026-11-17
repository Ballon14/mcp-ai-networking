import { z } from "zod";
import { jsonResult, toolHandler } from "../lib/result.mjs";
import { asArray, matchesSearch, pickFields } from "../lib/normalize.mjs";
import { pageRows, pagingNote } from "../lib/truncate.mjs";
import { deviceParam, readOnlyAnnotations, resolveDevice } from "./common.mjs";

const LEASE_FIELDS = [
  ".id",
  "address",
  "mac-address",
  "host-name",
  "status",
  "server",
  "interface",
  "dynamic",
  "disabled",
  "comment",
  "last-seen",
  "expires-after",
  "active-address",
  "active-mac-address"
];

const SEARCH_FIELDS = [
  "address",
  "mac-address",
  "host-name",
  "comment",
  "active-address",
  "active-mac-address"
];

export function registerDhcpTools(server, context) {
  server.registerTool(
    "get_dhcp_leases",
    {
      title: "Get MikroTik DHCP leases",
      description:
        "Read DHCP server leases (bound, waiting, offered) including address, MAC, hostname, server and expiry. Filter by status or search across address/MAC/hostname/comment.",
      inputSchema: {
        device: deviceParam,
        status: z
          .string()
          .min(1)
          .optional()
          .describe("Case-insensitive exact lease status filter, for example bound or waiting."),
        search: z
          .string()
          .min(1)
          .optional()
          .describe("Case-insensitive substring search on address, MAC, hostname, active address or comment."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum rows to return."),
        offset: z.number().int().min(0).optional().describe("Rows to skip, for pagination.")
      },
      annotations: readOnlyAnnotations
    },
    toolHandler(async ({ device, status, search, limit, offset }) => {
      const target = resolveDevice(context, device);
      const data = asArray(await context.client.get(target, "/rest/ip/dhcp-server/lease"));

      let rows = data;
      if (status) {
        const wanted = status.toLowerCase();
        rows = rows.filter((row) => String(row.status ?? "").toLowerCase() === wanted);
      }
      if (search) {
        rows = rows.filter((row) => matchesSearch(row, search, SEARCH_FIELDS));
      }

      const page = pageRows(
        rows.map((row) => pickFields(row, LEASE_FIELDS)),
        { limit, offset },
        { defaultLimit: context.config.maxRows, maxLimit: 500 }
      );

      const bound = rows.filter((row) => String(row.status ?? "").toLowerCase() === "bound").length;

      return jsonResult({
        summary: `${pagingNote(page, "DHCP leases")} ${bound} of ${rows.length} matching leases are bound.`,
        device: target.name,
        total: page.total,
        bound,
        offset: page.offset,
        limit: page.limit,
        truncated: page.truncated,
        leases: page.rows
      });
    })
  );
}
