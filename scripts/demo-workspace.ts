import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanup, prepare } from "./acp-smoke-config.js";

// Reuse the reviewed configuration verification; only the shell speaks A2A.
let stage = "isolation";
let interrupted = false;
let shell: ChildProcess | undefined;
const interrupt = () => {
  interrupted = true;
  process.exitCode = 130;
  shell?.kill("SIGTERM");
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  const workspace = await prepare();
  try {
    stage = "shell";
    if (interrupted) throw new Error("Demo interrupted before launch");
    shell = spawn("bash", [fileURLToPath(new URL("./demo.sh", import.meta.url)), "--isolated"], {
      cwd: workspace.cwd,
      env: {
        ...workspace.env,
        DEMO_ROOT: workspace.root,
        DEMO_REPO: fileURLToPath(new URL("../", import.meta.url)),
      },
      stdio: "inherit",
    });
    const child = shell;
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    stage = "cleanup";
    await cleanup(workspace.root);
  }
} catch {
  console.error(JSON.stringify({ demo: false, stage }));
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
