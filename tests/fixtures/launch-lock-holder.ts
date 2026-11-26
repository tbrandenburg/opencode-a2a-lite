// Child that takes the launch lock, announces it, then holds it until killed.
import { acquireLaunchLock } from "../../src/launch-lock.js";

const [file] = process.argv.slice(2) as [string];
await acquireLaunchLock({ file });
console.log("held");
await Bun.sleep(60_000);
