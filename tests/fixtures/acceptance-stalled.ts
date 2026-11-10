import { spawn } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

const marker = process.argv[2]!;
const mode = process.argv[3];
if (mode === "parent") {
  const child = spawn(process.execPath, [import.meta.filename, marker, "stalled"], {
    stdio: "ignore",
  });
  child.once("exit", () => process.exit(0));
  child.once("error", () => process.exit(1));
  process.stdin.resume();
  // Deliberately retain the lease across EOF/TERM and never answer initialize.
  process.on("SIGTERM", () => {
    process.exitCode = 0;
  });
} else {
  const server = createServer((socket) => socket.end());
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture listener");
    writeFileSync(`${marker}.pending`, JSON.stringify({ pid: process.pid, port: address.port }));
    renameSync(`${marker}.pending`, marker);
  });
  if (mode === "sentinel") {
    process.stdin.resume();
    process.stdin.once("end", () => server.close());
  }
}
