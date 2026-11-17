import { registerSystemTools } from "./system.mjs";
import { registerInterfaceTools } from "./interfaces.mjs";
import { registerRouteTools } from "./routes.mjs";
import { registerFirewallTools } from "./firewall.mjs";
import { registerDhcpTools } from "./dhcp.mjs";
import { registerDnsTools } from "./dns.mjs";
import { registerWirelessTools } from "./wireless.mjs";
import { registerLogTools } from "./logs.mjs";
import { registerDiagnosticsTools } from "./diagnostics.mjs";

export function registerTools(server, context) {
  registerSystemTools(server, context);
  registerInterfaceTools(server, context);
  registerRouteTools(server, context);
  registerFirewallTools(server, context);
  registerDhcpTools(server, context);
  registerDnsTools(server, context);
  registerWirelessTools(server, context);
  registerLogTools(server, context);
  registerDiagnosticsTools(server, context);
}
