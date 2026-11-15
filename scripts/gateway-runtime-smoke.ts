// Explicit provider-free smoke with the real OpenCode executable, not a live model test.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createGateway } from "../src/server.js";
import { cleanup, prepare } from "./acp-smoke-config.js";

let stage = "isolation";
try {
  const workspace = await prepare({ providerFree: true });
  try {
    stage = "gateway";
    const gateway = createGateway({
      workspace: workspace.cwd,
      port: 0,
      acp: { executable: workspace.executable, env: workspace.env },
    });
    let port: number | undefined;
    try {
      const { url } = await gateway.start();
      port = Number(new URL(url).port);
      const response = await fetch(new URL(".well-known/agent-card.json", url), {
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 200);
      const card = await response.json();
      assert.equal(card.capabilities.streaming, true);
      assert.equal(card.supportedInterfaces[0].url, url);
      console.log(JSON.stringify({ gatewayReady: true, cardVerified: true, realOpenCode: true }));
    } finally {
      stage = "gateway-cleanup";
      await gateway.close();
    }
    stage = "port-rebind";
    assert(port);
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    console.log(JSON.stringify({ portReclaimed: true }));
  } finally {
    stage = "workspace-cleanup";
    await cleanup(workspace.root);
  }
} catch {
  // OpenCode diagnostics can contain credentials or private configuration.
  console.error(JSON.stringify({ runtimeSmoke: false, stage }));
  process.exitCode = 1;
}
