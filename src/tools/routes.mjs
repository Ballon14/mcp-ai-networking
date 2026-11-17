import { z } from "zod";
import { jsonResult, toolHandler } from "../lib/result.mjs";
import { asArray, matchesSearch, pickFields, toBoolean } from "../lib/normalize.mjs";
import { pageRows, pagingNote } from "../lib/truncate.mjs";
import { deviceParam, readOnlyAnnotations, resolveDevice } from "./common.mjs";

const ROUTE_FIELDS = [
  "dst-address",
  "gateway",
  "distance",
  "pref-src",
  "active",
  "static",
  "dynamic",
  "connect",
  "connected",
  "disabled",
  "comment"
];

function isStatic(row) {
  return toBoolean(row.static);
}

function isConnected(row) {
  return toBoolean(row.connected) || toBoolean(row.connect);
}

function isDynamic(row) {
  return toBoolean(row.dynamic);
}

export function registerRouteTools(server, context) {
  server.registerTool(
    "get_routes",
    {
      title: "Get MikroTik IP routes",
      description:
        "Read the IPv4 or IPv6 routing table with destination, gateway, distance and route flags. Filter by route type (static/connected/dynamic) or destination prefix.",
      inputSchema: {
        device: deviceParam,
        family: z
          .enum(["ipv4", "ipv6"])
          .default("ipv4")
          .describe("Address family to read."),
        type: z
          .enum(["all", "static", "connected", "dynamic"])
          .default("all")
          .describe("Route type filter."),
        dst: z
          .string()
          .min(1)
          .optional()
          .describe("Case-insensitive substring filter on dst-address."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum rows to return."),
        offset: z.number().int().min(0).optional().describe("Rows to skip, for pagination.")
      },
      annotations: readOnlyAnnotations
    },
    toolHandler(async ({ device, family, type, dst, limit, offset }) => {
      const target = resolveDevice(context, device);
      const path = family === "ipv6" ? "/rest/ipv6/route" : "/rest/ip/route";
      const data = asArray(await context.client.get(target, path));

      let rows = data;
      if (type === "static") rows = rows.filter(isStatic);
      if (type === "connected") rows = rows.filter(isConnected);
      if (type === "dynamic") rows = rows.filter(isDynamic);
      if (dst) rows = rows.filter((row) => matchesSearch(row, dst, ["dst-address"]));

      const page = pageRows(
        rows.map((row) => pickFields(row, ROUTE_FIELDS)),
        { limit, offset },
        { defaultLimit: context.config.maxRows, maxLimit: 500 }
      );

      return jsonResult({
        summary: pagingNote(page, `${family.toUpperCase()} routes (${type}) on "${target.name}"`),
        device: target.name,
        family,
        type,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        truncated: page.truncated,
        routes: page.rows
      });
    })
  );
}
