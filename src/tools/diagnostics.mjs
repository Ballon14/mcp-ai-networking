import { z } from "zod";
import { jsonResult, toolHandler } from "../lib/result.mjs";
import { asArray, toNumber } from "../lib/normalize.mjs";
import { RouterOsError } from "../routeros/errors.mjs";
import { deviceParam, readOnlyAnnotations, resolveDevice } from "./common.mjs";

const ADDRESS_PATTERN = /^[a-zA-Z0-9._:%\-[\]]+$/;

function buildPingStats(rows, requestedCount) {
  const summaryRow = rows.find(
    (row) => row?.["packet-loss"] !== undefined || row?.received !== undefined
  );
  const replies = rows.filter((row) => row?.time !== undefined).length;
  const timeouts = rows.filter((row) =>
    String(row?.status ?? "").toLowerCase().includes("timeout")
  ).length;

  const sent = toNumber(summaryRow?.sent) ?? (replies + timeouts > 0 ? replies + timeouts : requestedCount);
  const received = toNumber(summaryRow?.received) ?? replies;
  const packetLoss =
    summaryRow?.["packet-loss"] ??
    (sent > 0 ? `${Math.round(((sent - received) / sent) * 100)}%` : null);

  const stats = { sent, received, packetLoss };
  for (const field of ["min-rtt", "avg-rtt", "max-rtt", "jitter"]) {
    if (summaryRow?.[field] !== undefined) {
      stats[field] = summaryRow[field];
    }
  }
  return stats;
}

export function registerDiagnosticsTools(server, context) {
  server.registerTool(
    "ping",
    {
      title: "Ping from the MikroTik router",
      description:
        "Run a short ping from the router itself to an IP address or hostname and return per-reply latency plus packet loss statistics. Requires the test user policy on RouterOS.",
      inputSchema: {
        device: deviceParam,
        address: z
          .string()
          .min(1)
          .max(255)
          .regex(ADDRESS_PATTERN, "address must be an IP address or hostname")
          .describe("Destination IP address or hostname."),
        count: z.number().int().min(1).max(10).default(4).describe("Number of pings (1-10).")
      },
      annotations: { ...readOnlyAnnotations, idempotentHint: true }
    },
    toolHandler(async ({ device, address, count }) => {
      const target = resolveDevice(context, device);

      let data;
      try {
        data = await context.client.request(target, "/rest/ping", {
          method: "POST",
          body: { address, count: String(count) }
        });
      } catch (error) {
        if (error instanceof RouterOsError && error.status === 403) {
          throw new RouterOsError(
            `${error.message} The ping tool requires the "test" policy on the RouterOS user.`,
            { status: 403, device: target.name }
          );
        }
        throw error;
      }

      const rows = asArray(data);
      const stats = buildPingStats(rows, count);

      return jsonResult({
        summary: `Ping ${address} from "${target.name}": ${stats.received}/${stats.sent} replies, packet loss ${stats.packetLoss}.`,
        device: target.name,
        address,
        count,
        stats,
        replies: rows
      });
    })
  );
}
