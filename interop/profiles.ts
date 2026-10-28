import assert from "node:assert/strict";
import { join } from "node:path";

export { tools } from "./bridge-proxy.js";
export type Profile = { root: string; cwd: string; env: NodeJS.ProcessEnv };
export type NetworkConnection = { binary: string; directory: string; peers: string[] };

export function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value), "Expected object");
  return value as Record<string, unknown>;
}

export function proxyArgs(profile: Profile, connection: NetworkConnection) {
  return [
    join(import.meta.dir, "bridge-proxy.ts"),
    connection.binary,
    connection.directory,
    join(profile.root, "mcp-receipts.jsonl"),
    JSON.stringify(connection.peers),
  ];
}
