// Child for the stale-lock race test: waits for a go-file, then tries to take the lock.
import { existsSync } from "node:fs";
import { acquireLock } from "../../src/state-lock.js";

const [directory, go] = process.argv.slice(2) as [string, string];
while (!existsSync(go)) Bun.sleepSync(1);
try {
  const lock = acquireLock(directory);
  console.log("won");
  await Bun.sleep(800);
  lock.release();
} catch {
  console.log("busy");
}
