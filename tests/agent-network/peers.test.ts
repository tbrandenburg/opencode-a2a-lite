import { expect, test } from "bun:test";
import sample from "../../examples/agent-network/peers.example.json" with { type: "json" };
import { loopback, toolDecision } from "../../examples/agent-network/bridge-proxy.js";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// This checks the example contract only; no runtime consumes this manifest.
function valid(value: unknown): boolean {
  if (!object(value) || Object.keys(value).join() !== "peers" || !Array.isArray(value.peers))
    return false;
  if (!value.peers.length) return false;
  const names = new Set<string>();
  const urls = new Set<string>();
  return value.peers.every((peer: unknown) => {
    if (!object(peer) || Object.keys(peer).sort().join() !== "name,url") return false;
    const name = peer.name;
    const url = peer.url;
    if (typeof name !== "string" || !name.trim() || name !== name.trim() || names.has(name))
      return false;
    if (!loopback(url, true) || /[?#]/.test(url) || new URL(url).href !== url || urls.has(url))
      return false;
    names.add(name);
    urls.add(url);
    return true;
  });
}

test("peer example has only unique names and canonical root loopback URLs", () => {
  expect(valid(sample)).toBe(true);
  expect(sample.peers.map((peer) => peer.name)).toEqual(["planner", "reviewer"]);
  const urls = sample.peers.map((peer) => peer.url);
  for (const peer of sample.peers) {
    expect(loopback(peer.url, true)).toBe(true);
    expect(toolDecision("a2a_send_message", { peer_url: peer.url }, urls, 1)).toBeUndefined();
    expect(toolDecision("a2a_send_message", { peer_url: peer.url.slice(0, -1) }, urls, 1)).toBe(
      "peer",
    );
  }
  expect(toolDecision("a2a_send_message", { peer_url: "http://127.0.0.1:41243/" }, urls, 1)).toBe(
    "peer",
  );
});

test("sample contract rejects shape changes, empty names and duplicate names or URLs", () => {
  for (const value of [
    null,
    [],
    {},
    { peers: [] },
    { peers: "invalid" },
    { ...sample, discovery: true },
    { peers: [null] },
    { peers: [{ ...sample.peers[0], workspace: "/workspace" }] },
    { peers: [{ url: sample.peers[0]!.url }] },
    { peers: [{ name: "planner" }] },
    ...["", " ", " planner ", 1].map((name) => ({
      peers: [{ name, url: sample.peers[0]!.url }],
    })),
    { peers: [sample.peers[0], { ...sample.peers[1], name: "planner" }] },
    { peers: [sample.peers[0], { name: "other", url: sample.peers[0]!.url }] },
  ]) {
    expect(valid(value)).toBe(false);
  }
  expect(valid({ peers: [{ name: "other", url: "https://[::1]:41243/" }] })).toBe(true);
});

test("sample contract rejects unsafe and noncanonical URLs including bare delimiters", () => {
  for (const url of [
    "http://user:password@127.0.0.1:41241/",
    "http://example.com/",
    "http://127.0.0.2/",
    "http://127.0.0.1:41241/path",
    "http://127.0.0.1:41241/?query=value",
    "http://127.0.0.1:41241/#fragment",
    "http://127.0.0.1:41241/?",
    "http://127.0.0.1:41241/#",
    "http://127.0.0.1:41241",
    "http://LOCALHOST:41241/",
    "http://127.1:41241/",
    "http://127.0.0.1:80/",
    "http://127.0.0.1:41241/../",
    "ftp://localhost/",
    "not a URL",
    null,
  ]) {
    expect(valid({ peers: [{ name: "planner", url }] })).toBe(false);
    expect(
      toolDecision(
        "a2a_send_message",
        { peer_url: url },
        sample.peers.map((peer) => peer.url),
        1,
      ),
    ).toBe("peer");
  }
});
