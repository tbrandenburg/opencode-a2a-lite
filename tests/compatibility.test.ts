import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { once } from "node:events";
import { describe, expect, test } from "bun:test";
import * as a2a from "@a2a-js/sdk";
import * as acp from "@agentclientprotocol/sdk";

describe("Bun runtime compatibility probes", () => {
  test("imports the official A2A v1 and stable ACP v1 SDK entrypoints", () => {
    expect(a2a).toBeDefined();
    expect(acp.ndJsonStream).toBeFunction();
    expect(acp.client).toBeFunction();
  });

  test("supports bidirectional node:child_process stdin/stdout and exit detection", async () => {
    const child = spawn("node", [
      "-e",
      "process.stdin.on('data', chunk => process.stdout.write(chunk)); process.stdin.on('end', () => process.exit(7));",
    ]);
    const stdout = Readable.toWeb(child.stdout);
    const writer = Writable.toWeb(child.stdin).getWriter();
    const reader = stdout.getReader();
    const input = new TextEncoder().encode("probe-line\n");

    await writer.write(input);
    await writer.close();
    const output = await reader.read();
    const [code] = (await once(child, "close")) as [number, string | null];
    const closure = await reader.read();

    expect(new TextDecoder().decode(output.value)).toBe("probe-line\n");
    expect(output.done).toBe(false);
    expect(closure.done).toBe(true);
    expect(code).toBe(7);
    expect(child.stdin.destroyed).toBe(true);
  });

  test("creates an ACP v1 NDJSON stream over Web Streams", async () => {
    const outgoing: Uint8Array[] = [];
    const output = new WritableStream<Uint8Array>({
      write(chunk) {
        outgoing.push(chunk);
      },
    });
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"probe"}\n'));
        controller.close();
      },
    });
    const stream = acp.ndJsonStream(output, input);
    const writer = stream.writable.getWriter();

    await writer.write({ jsonrpc: "2.0", id: 2, method: "probe-response", result: {} });
    await writer.close();

    expect(stream.readable.getReader()).toBeDefined();
    expect(outgoing).toHaveLength(1);
    expect(new TextDecoder().decode(outgoing[0])).toContain('"method":"probe-response"');
  });
});
