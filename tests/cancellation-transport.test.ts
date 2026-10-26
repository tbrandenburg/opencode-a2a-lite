import { expect, test } from "bun:test";
import { request, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { createGateway } from "../src/server.js";

type WireTask = {
  id: string;
  status: { state: string };
  artifacts?: { parts: { text?: string }[] }[];
};
type WireEvent = {
  task?: WireTask;
  artifactUpdate?: {
    artifact: { parts: { text?: string }[] };
    append?: boolean;
    lastChunk?: boolean;
  };
  statusUpdate?: { status: { state: string } };
};
type RpcResult = { result?: WireTask; error?: object };
const fixture = fileURLToPath(new URL("./fixtures/acp-cancellation-transport.ts", import.meta.url));

async function rpc(url: string, method: string, params: object): Promise<RpcResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  return response.json();
}

function pausedStream(url: string) {
  const ready = Promise.withResolvers<{ response: IncomingMessage; id: string }>();
  const ended = Promise.withResolvers<void>();
  const events: WireEvent[] = [];
  let id = "";
  let pending = "";
  const client = request(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "A2A-Version": "1.0",
      },
    },
    (response) => {
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const event = (JSON.parse(line.slice(5)) as { result: WireEvent }).result;
          events.push(event);
          if (event.task) id = event.task.id;
          if (event.artifactUpdate?.artifact.parts[0]?.text === "A") {
            response.pause();
            ready.resolve({ response, id });
          }
        }
      });
      response.once("end", () => ended.resolve());
      response.once("error", (error) => {
        ready.reject(error);
        ended.reject(error);
      });
    },
  );
  client.setTimeout(5_000, () => client.destroy(new Error("HTTP probe timed out")));
  client.once("error", (error) => ready.reject(error));
  client.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "SendStreamingMessage",
      params: {
        message: { messageId: "transport", role: "ROLE_USER", parts: [{ text: "test" }] },
      },
    }),
  );
  // A deliberate disconnect need not reach the response's normal end event.
  void ended.promise.catch(() => undefined);
  return { ready: ready.promise, ended: ended.promise, events, close: () => client.destroy() };
}

test.each(
  ["disconnect", "slow-reader"].flatMap((transport) =>
    ["canceled", "completed"].map((outcome) => ({ transport, outcome })),
  ),
)(
  "real HTTP %j retains persistence and truthful cancel outcome",
  async ({ transport, outcome }) => {
    // Port 0 atomically reserves a free ephemeral port; no shared listener is touched.
    const gateway = createGateway({
      workspace: process.cwd(),
      port: 0,
      acp: {
        executable: process.execPath,
        args: [fixture, outcome],
        versionArgs: [fixture, outcome, "--version"],
        env: { PATH: process.env.PATH },
        startupTimeoutMs: 2_000,
        promptTimeoutMs: 10_000,
        cancelTimeoutMs: 3_000,
        closeTimeoutMs: 600,
      },
    });
    const ready = await gateway.start();
    const stream = pausedStream(ready.url);
    try {
      const { response, id } = await stream.ready;
      expect(id.length).toBeGreaterThan(0);
      expect(response.headers["content-type"]).toContain("text/event-stream");
      if (transport === "disconnect") {
        const closed = new Promise<void>((resolve) => response.once("close", resolve));
        response.destroy();
        await closed;
        expect(response.destroyed).toBe(true);
      } else {
        expect(response.isPaused()).toBe(true);
      }
      const initial = await rpc(ready.url, "GetTask", { id });
      expect(initial.result?.status.state).toBe("TASK_STATE_WORKING");
      const start = performance.now();
      const canceled = await rpc(ready.url, "CancelTask", { id });
      expect(performance.now() - start).toBeLessThan(5_000);
      const state = outcome === "canceled" ? "TASK_STATE_CANCELED" : "TASK_STATE_COMPLETED";
      if (outcome === "canceled") expect(canceled.result?.status.state).toBe(state);
      else expect(canceled.error).toBeDefined();
      const stored = await rpc(ready.url, "GetTask", { id });
      expect(stored.result?.status.state).toBe(state);
      const texts =
        stored.result?.artifacts
          ?.flatMap((artifact) => artifact.parts)
          .map((part) => part.text ?? "") ?? [];
      expect(texts.map((text) => text.length)).toEqual([1, ...Array<number>(64).fill(65_536), 0]);
      expect(texts[0]).toBe("A");
      expect(texts.slice(1, -1).every((text) => text === "B".repeat(65_536))).toBe(true);
      expect(texts.at(-1)).toBe("");
      if (transport === "slow-reader") {
        expect(response.isPaused()).toBe(true);
        expect(stream.events.filter((event) => event.artifactUpdate)).toHaveLength(1);
        response.resume();
        await stream.ended;
        const updates = stream.events.flatMap((event) =>
          event.artifactUpdate ? [event.artifactUpdate] : [],
        );
        expect(updates.map((update) => update.artifact.parts[0]?.text ?? "")).toEqual(texts);
        expect(updates.at(-1)).toMatchObject({ append: true, lastChunk: true });
        expect(stream.events.at(-1)?.statusUpdate?.status.state).toBe(state);
      }
    } finally {
      stream.close();
      await gateway.close();
    }
  },
  15_000,
);
