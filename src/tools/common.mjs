import { z } from "zod";
import { RouterOsError } from "../routeros/errors.mjs";

export const deviceParam = z
  .string()
  .min(1)
  .optional()
  .describe("Device name from mikrotik.config.json. Defaults to the configured defaultDevice.");

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

export const localAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

export function resolveDevice(context, name) {
  const target = name ?? context.config.defaultDevice;
  const device = context.config.devices.find((candidate) => candidate.name === target);
  if (!device) {
    const available = context.config.devices.map((candidate) => candidate.name).join(", ");
    throw new RouterOsError(
      `Unknown device "${target}". Configured devices: ${available}. Use list_devices to see the available devices.`
    );
  }
  return device;
}
