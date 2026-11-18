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

const SPEED_UNITS = { "": 1, k: 1e3, m: 1e6, g: 1e9 };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLinkSpeedBits(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([kmg]?)bps\s*$/i.exec(value);
  if (!match) return null;
  const multiplier = SPEED_UNITS[match[2].toLowerCase()];
  const bits = Number.parseFloat(match[1]) * multiplier;
  return Number.isFinite(bits) && bits > 0 ? bits : null;
}

function counterDelta(previous, current) {
  if (previous === null || current === null) {
    return { value: null, reset: false };
  }
  const difference = current - previous;
  if (difference < 0) {
    return { value: null, reset: true };
  }
  return { value: difference, reset: false };
}

function formatBitsPerSecond(bps) {
  if (typeof bps !== "number" || !Number.isFinite(bps)) return "n/a";
  const units = [
    [1e9, "Gbps"],
    [1e6, "Mbps"],
    [1e3, "kbps"]
  ];
  for (const [scale, label] of units) {
    if (bps >= scale) {
      return `${Math.round((bps / scale) * 10) / 10} ${label}`;
    }
  }
  return `${Math.round(bps)} bps`;
}

function utilizationPercent(bps, speedBits) {
  if (speedBits === null || bps === null) return undefined;
  return Math.round((bps / speedBits) * 1000) / 10;
}

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

  server.registerTool(
    "get_interface_traffic",
    {
      title: "Sample MikroTik interface traffic",
      description:
        "Measure current per-interface throughput without changing configuration: reads /interface twice with a short delay and reports rx/tx byte deltas, bits per second and link utilization. Uses GET only; RouterOS monitor-traffic is not called because it is a write-guarded command.",
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
          .describe("Only measure interfaces that are currently running."),
        sampleMs: z
          .number()
          .int()
          .min(100)
          .max(15000)
          .default(2000)
          .describe("Delay in milliseconds between the two counter reads."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum rows to return."),
        offset: z.number().int().min(0).optional().describe("Rows to skip, for pagination.")
      },
      annotations: readOnlyAnnotations
    },
    toolHandler(async ({ device, name, runningOnly, sampleMs, limit, offset }) => {
      const target = resolveDevice(context, device);
      const first = asArray(await context.client.get(target, "/rest/interface"));
      const startedAt = Date.now();

      await delay(sampleMs);

      const second = asArray(await context.client.get(target, "/rest/interface"));
      const intervalMs = Math.max(Date.now() - startedAt, 1);
      const seconds = intervalMs / 1000;

      const previousByName = new Map();
      for (const row of first) {
        if (row && typeof row.name === "string") {
          previousByName.set(row.name, row);
        }
      }

      const rows = [];
      for (const row of second) {
        if (!row || typeof row.name !== "string") continue;
        if (name && !matchesSearch(row, name, ["name"])) continue;
        if (runningOnly && !toBoolean(row.running)) continue;

        const before = previousByName.get(row.name);
        const rx = counterDelta(toNumber(before?.["rx-byte"]), toNumber(row["rx-byte"]));
        const tx = counterDelta(toNumber(before?.["tx-byte"]), toNumber(row["tx-byte"]));
        const rxBps = rx.value === null ? null : Math.round((rx.value * 8) / seconds);
        const txBps = tx.value === null ? null : Math.round((tx.value * 8) / seconds);
        const speedBits = parseLinkSpeedBits(row.speed);

        rows.push({
          name: row.name,
          type: row.type,
          running: toBoolean(row.running),
          comment: row.comment,
          speed: row.speed,
          "rx-byte-delta": rx.value,
          "tx-byte-delta": tx.value,
          "rx-bps": rxBps,
          "tx-bps": txBps,
          "rx-utilization-percent": utilizationPercent(rxBps, speedBits),
          "tx-utilization-percent": utilizationPercent(txBps, speedBits),
          counterReset: rx.reset || tx.reset
        });
      }

      rows.sort(
        (a, b) =>
          (b["rx-bps"] ?? 0) + (b["tx-bps"] ?? 0) - ((a["rx-bps"] ?? 0) + (a["tx-bps"] ?? 0))
      );

      const page = pageRows(
        rows,
        { limit, offset },
        { defaultLimit: context.config.maxRows, maxLimit: 500 }
      );

      const busiest = rows[0];
      const busiestNote = busiest
        ? `Busiest interface "${busiest.name}" at rx ${formatBitsPerSecond(busiest["rx-bps"])}, tx ${formatBitsPerSecond(busiest["tx-bps"])}.`
        : "No matching interfaces.";

      return jsonResult({
        summary: `${pagingNote(page, "Interface traffic")} Two counter reads ${intervalMs} ms apart; ${rows.length} interface(s) measured. ${busiestNote}`,
        device: target.name,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        truncated: page.truncated,
        sampleMs,
        intervalMs,
        interfaces: page.rows
      });
    })
  );
}
