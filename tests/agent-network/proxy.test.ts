import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import {
  filterCatalog,
  inputHash,
  loopback,
  readPackets,
  toolDecision,
  tools,
} from "../../examples/agent-network/bridge-proxy.js";

const peers = ["http://127.0.0.1:4123/", "http://[::1]:4124/"];

describe("network bridge endpoint guard", () => {
  test("permits configured root loopback peers and local discovery", () => {
    expect(
      toolDecision("a2a_send_message", { peer_url: peers[0], text: "private" }, peers, 1),
    ).toBeUndefined();
    expect(
      toolDecision("a2a_get_task", { peer_url: peers[1], task_id: "task" }, peers, 40),
    ).toBeUndefined();
    expect(toolDecision("a2a_list_agents", {}, peers, 2)).toBeUndefined();
    expect(tools).toHaveLength(6);
  });

  test("rejects unknown, non-loopback, non-root and non-exact peers", () => {
    for (const peer_url of [
      "http://127.0.0.1:9999/",
      "http://example.com/",
      "http://127.0.0.1:4123/path",
      "http://127.0.0.1:4123",
      null,
    ]) {
      expect(toolDecision("a2a_send_streaming", { peer_url }, peers, 1)).toBe("peer");
    }
    expect(
      toolDecision("a2a_send_message", { nested: [{ peer_url: "http://example.com/" }] }, peers, 1),
    ).toBe("peer");
    expect(
      toolDecision(
        "a2a_send_message",
        { peer_url: "http://example.com/" },
        ["http://example.com/"],
        1,
      ),
    ).toBe("peer");
  });

  test("denies inbox and unknown tools even with a configured peer", () => {
    expect(toolDecision("a2a_inbox", { peer_url: peers[0] }, peers, 1)).toBe("tool");
    expect(toolDecision("unknown", {}, peers, 1)).toBe("tool");
    expect(toolDecision(undefined, {}, peers, 1)).toBe("tool");
    expect(toolDecision("a2a_send_message", { peer_url: peers[0] }, peers, 41)).toBe("budget");
  });

  test("rejects URL credentials, schemes, queries and non-root allowlist entries", () => {
    expect(loopback("http://localhost:9000/directory")).toBe(true);
    expect(loopback("https://localhost:9000/", true)).toBe(true);
    expect(loopback("http://localhost:9000/directory", true)).toBe(false);
    for (const url of [
      "ftp://localhost/",
      "http://user:pass@localhost/",
      "http://localhost/?secret=x",
      "http://localhost/#fragment",
      "http://127.0.0.2/",
      "not a URL",
    ]) {
      expect(loopback(url, true)).toBe(false);
    }
  });

  test("filters real schemas without fabricating allowed but absent tools", () => {
    const schema = {
      name: "a2a_whoami",
      inputSchema: { type: "object", properties: {} },
      description: "real",
    };
    const result = {
      tools: [schema, { name: "a2a_inbox" }, { name: "unknown" }, null],
      nextCursor: "cursor",
    };
    expect(filterCatalog(result)).toEqual(["a2a_whoami"]);
    expect(result.tools).toEqual([schema]);
    expect(result.tools[0]).toBe(schema);
    expect(result.nextCursor).toBe("cursor");
    expect(() => filterCatalog({ tools: "invalid" })).toThrow();
  });

  test("hashes text or canonical arguments without retaining plaintext", () => {
    expect(inputHash({ text: "hello", peer_url: peers[0] })).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    const canonical = "c461c47a913352f1a21e3f2ea49e1fd34754c0dc12cb7366e4636d5e186c6c6e";
    expect(inputHash({ b: 2, a: { d: 4, c: 3 } })).toBe(canonical);
    expect(inputHash({ a: { c: 3, d: 4 }, b: 2 })).toBe(canonical);
    expect(inputHash({ task_id: "private-task" })).toMatch(/^[a-f0-9]{64}$/);
  });

  test("reads fragmented JSONL and server requests without inventing schemas", async () => {
    const received: Record<string, unknown>[] = [];
    await readPackets(
      Readable.from([
        '{"jsonrpc":"2.0","method":"notifications/',
        'initialized"}\n{"jsonrpc":"2.0","id":2,"method":"sampling/createMessage","params":{"messages":[]}}',
      ]),
      async (packet) => {
        received.push(packet);
      },
    );
    expect(received[0]).toEqual({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(received[1]).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "sampling/createMessage",
      params: { messages: [] },
    });
    expect(received).toHaveLength(2);
  });

  test("rejects malformed, non-object and oversized transport before delivery", async () => {
    const received: Record<string, unknown>[] = [];
    for (const data of [
      "not-json\n",
      "[]\n",
      '{"jsonrpc":"1.0"}\n',
      "x".repeat(4 * 1024 * 1024 + 1),
    ]) {
      await expect(
        readPackets(Readable.from([data]), async (packet) => {
          received.push(packet);
        }),
      ).rejects.toThrow();
    }
    expect(received).toEqual([]);
  });

  test("CLI rejects unsafe endpoints and wrong executable pins with sanitized output", () => {
    const script = new URL("../../examples/agent-network/bridge-proxy.ts", import.meta.url)
      .pathname;
    for (const directory of ["http://example.com/private-input", "http://127.0.0.1:4123/"]) {
      const child = spawnSync(
        process.execPath,
        [
          script,
          "/usr/bin/false",
          directory,
          "/tmp/opencode/unused-proxy-receipt.jsonl",
          JSON.stringify(peers),
        ],
        {
          env: { PATH: "/usr/bin:/bin", HOME: "/tmp/opencode" },
          encoding: "utf8",
          timeout: 5000,
          killSignal: "SIGKILL",
        },
      );
      expect(child.status).toBe(1);
      expect(child.stdout).toBe("");
      expect(child.stderr).toBe("Bridge proxy configuration failure.\n");
    }
  });
});
