import { z } from "zod";
import { jsonResult, toolHandler } from "../lib/result.mjs";
import { asArray, matchesSearch, pickFields } from "../lib/normalize.mjs";
import { pageRows, pagingNote } from "../lib/truncate.mjs";
import { RouterOsError } from "../routeros/errors.mjs";
import { deviceParam, readOnlyAnnotations, resolveDevice } from "./common.mjs";

const CLIENT_FIELDS = [
  "interface",
  "mac-address",
  "ssid",
  "signal",
  "signal-strength",
  "signal-to-noise",
  "tx-rate",
  "rx-rate",
  "uptime",
  "bytes",
  "packets",
  "auth-type",
  "vlan-id"
];

async function readRegistrationTable(context, device) {
  try {
    const data = await context.client.get(device, "/rest/interface/wifi/registration-table");
    return { source: "wifi", data: asArray(data) };
  } catch (error) {
    const notFound = error instanceof RouterOsError && (error.status === 404 || error.status === 400);
    if (!notFound) throw error;
  }

  const data = await context.client.get(device, "/rest/interface/wireless/registration-table");
  return { source: "wireless", data: asArray(data) };
}

export function registerWirelessTools(server, context) {
  server.registerTool(
    "get_wireless_clients",
    {
      title: "Get MikroTik wireless clients",
      description:
        "Read connected wireless clients (registration table) with SSID, signal strength, rates and uptime. Supports RouterOS v7 wifi and legacy wireless packages.",
      inputSchema: {
        device: deviceParam,
        interface: z
          .string()
          .min(1)
          .optional()
          .describe("Case-insensitive substring filter on the wireless interface name."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum rows to return."),
        offset: z.number().int().min(0).optional().describe("Rows to skip, for pagination.")
      },
      annotations: readOnlyAnnotations
    },
    toolHandler(async ({ device, interface: iface, limit, offset }) => {
      const target = resolveDevice(context, device);
      const { source, data } = await readRegistrationTable(context, target);

      let rows = data;
      if (iface) {
        rows = rows.filter((row) => matchesSearch(row, iface, ["interface"]));
      }

      const page = pageRows(
        rows.map((row) => pickFields(row, CLIENT_FIELDS)),
        { limit, offset },
        { defaultLimit: context.config.maxRows, maxLimit: 500 }
      );

      return jsonResult({
        summary: `${pagingNote(page, "Wireless clients")} Source: ${source} registration table.`,
        device: target.name,
        source,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        truncated: page.truncated,
        clients: page.rows
      });
    })
  );
}
