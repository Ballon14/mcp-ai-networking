import { jsonResult, toolHandler } from "../lib/result.mjs";
import { firstObject, pickFields, toNumber } from "../lib/normalize.mjs";
import { publicDeviceInfo } from "../config.mjs";
import {
  deviceParam,
  localAnnotations,
  readOnlyAnnotations,
  resolveDevice
} from "./common.mjs";

const RESOURCE_FIELDS = [
  "architecture-name",
  "board-name",
  "build-time",
  "cpu",
  "cpu-count",
  "cpu-frequency",
  "cpu-load",
  "free-hdd-space",
  "free-memory",
  "platform",
  "total-hdd-space",
  "total-memory",
  "uptime",
  "version"
];

const NUMERIC_RESOURCE_FIELDS = new Set([
  "cpu-count",
  "cpu-frequency",
  "cpu-load",
  "free-hdd-space",
  "free-memory",
  "total-hdd-space",
  "total-memory"
]);

function normalizeResource(resource) {
  const picked = pickFields(resource, RESOURCE_FIELDS);
  for (const field of NUMERIC_RESOURCE_FIELDS) {
    if (picked[field] !== undefined) {
      picked[field] = toNumber(picked[field]);
    }
  }
  const free = picked["free-memory"];
  const total = picked["total-memory"];
  if (typeof free === "number" && typeof total === "number" && total > 0) {
    picked["memory-used-percent"] = Math.round(((total - free) / total) * 1000) / 10;
  }
  return picked;
}

export function registerSystemTools(server, context) {
  server.registerTool(
    "system_info",
    {
      title: "MikroTik system information",
      description:
        "Read the router identity and system resource data (model, RouterOS version, uptime, CPU load, memory usage) from a MikroTik RouterOS v7 device.",
      inputSchema: { device: deviceParam },
      annotations: readOnlyAnnotations
    },
    toolHandler(async ({ device }) => {
      const target = resolveDevice(context, device);
      const [identityData, resourceData] = await Promise.all([
        context.client.get(target, "/rest/system/identity", { cacheTtlMs: 10000 }),
        context.client.get(target, "/rest/system/resource", { cacheTtlMs: 5000 })
      ]);

      const identity = firstObject(identityData);
      const resource = normalizeResource(firstObject(resourceData));

      return jsonResult({
        summary: `Device "${target.name}" runs RouterOS ${resource.version ?? "unknown"} (${resource["board-name"] ?? "unknown board"}).`,
        device: target.name,
        host: target.host,
        identity: { name: identity.name ?? null },
        resource
      });
    })
  );

  server.registerTool(
    "list_devices",
    {
      title: "List configured MikroTik devices",
      description:
        "List the MikroTik devices configured in mikrotik.config.json and which one is the default. Does not contact the routers.",
      inputSchema: {},
      annotations: localAnnotations
    },
    toolHandler(async () => {
      return jsonResult({
        summary: `${context.config.devices.length} device(s) configured, default is "${context.config.defaultDevice}".`,
        defaultDevice: context.config.defaultDevice,
        devices: context.config.devices.map((device) => ({
          ...publicDeviceInfo(device),
          default: device.name === context.config.defaultDevice
        }))
      });
    })
  );
}
