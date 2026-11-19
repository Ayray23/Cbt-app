// Release switch for the high-risk school LAN cloud API.
// The server flag is authoritative. A browser-only switch cannot protect grants.
import { HttpError } from "./domain.mjs";

export function lanEnabled(env = process.env) {
  return env.CBT_ENABLE_LAN === "true";
}

export function assertLanAllowed(action, env = process.env) {
  if (typeof action === "string" && action.startsWith("lan.") && !lanEnabled(env))
    throw new HttpError(
      503,
      "School LAN exam mode is disabled until its supervised deployment is approved.",
    );
}
