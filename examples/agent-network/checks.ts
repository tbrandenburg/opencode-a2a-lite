import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { record, tools } from "./profiles.js";
import { mcp, payloadText, until } from "./transport.js";
import type { Worker } from "./workers.js";

type Connection = Awaited<ReturnType<typeof mcp>>;
export function task(value: unknown) {
  const result = record(value);
  return record(result.task ?? result);
}
export function state(value: unknown) {
  return record(task(value).status).state;
}

export async function interoperability(connection: Connection, workers: Worker[]) {
  const catalog = await connection.client.listTools();
  assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), [...tools].sort());
  const peers = await connection.call("a2a_list_agents", {});
  assert(Array.isArray(peers));
  for (const worker of workers) {
    const peer: Record<string, unknown> | undefined = peers
      .map(record)
      .find((entry) => entry.url === worker.url);
    assert(peer);
    assert.equal(record(peer.card).name, worker.id);
  }
  const planner = workers[0]!;
  const reviewer = workers[1]!;
  const marker = `continuity-${randomUUID()}`;
  const first = task(
    await connection.call("a2a_send_message", {
      peer_url: planner.url,
      text: `Remember acceptance token ${marker}. Reply only with the exact token.`,
      blocking: true,
    }),
  );
  assert.equal(state(first), "TASK_STATE_COMPLETED");
  assert.equal(payloadText(first), marker);
  const followup = task(
    await connection.call("a2a_send_message", {
      peer_url: planner.url,
      text: "Recall the acceptance token from my earlier message. Reply only with the exact token.",
      context_id: first.contextId,
      blocking: true,
    }),
  );
  assert.equal(payloadText(followup), marker);
  assert.equal(followup.contextId, first.contextId);
  assert.notEqual(followup.id, first.id);
  const streamMarker = `stream-${randomUUID()}`;
  const events = await connection.call("a2a_send_streaming", {
    peer_url: reviewer.url,
    text: `Reply only with the exact acceptance token ${streamMarker}.`,
    timeout_s: 120,
  });
  assert(Array.isArray(events));
  const updates = events.map(record);
  assert(
    updates.some((event) =>
      event.statusUpdate
        ? record(record(event.statusUpdate).status).state === "TASK_STATE_COMPLETED"
        : false,
    ),
  );
  const streamed = updates
    .filter((event) => event.artifactUpdate)
    .map((event) => payloadText({ artifacts: [record(event.artifactUpdate).artifact] }))
    .join("");
  assert.equal(streamed, streamMarker);
  const unknown = await connection.call(
    "a2a_get_task",
    { peer_url: planner.url, task_id: randomUUID() },
    true,
  );
  assert.match(String(unknown), /not found|not exist/i);
  await connection.call(
    "a2a_get_task",
    { peer_url: "http://127.0.0.1:1/", task_id: "missing" },
    true,
  );
  await connection.call("a2a_complete_task", { task_id: "missing", text: "not allowed" }, true);
  return {
    discovery: true,
    exactStreaming: true,
    returnedContextContinuity: true,
    negativeCases: 3,
  };
}

export async function cancellation(connection: Connection, workers: Worker[]) {
  const planner = workers[0]!;
  const reviewer = workers[1]!;
  const active = task(
    await connection.call("a2a_send_message", {
      peer_url: planner.url,
      text: "Lifecycle probe: write an original story of at least 8000 words. Start immediately. Do not stop early or use tools.",
    }),
  );
  const get = () => connection.call("a2a_get_task", { peer_url: planner.url, task_id: active.id });
  await until(
    async () => {
      const current = task(await get());
      assert.equal(state(current), "TASK_STATE_WORKING", "Long task ended before intervention");
      return payloadText(current) ? current : undefined;
    },
    "real text before cancellation",
    90_000,
    4_000,
  );
  const busy = task(
    await connection.call("a2a_send_message", {
      peer_url: planner.url,
      text: "Reply only BUSY-MUST-NOT-RUN.",
      blocking: true,
    }),
  );
  assert.equal(state(busy), "TASK_STATE_FAILED");
  assert.equal(payloadText(busy), "");
  const other = task(
    await connection.call("a2a_send_message", {
      peer_url: reviewer.url,
      text: "Reply only with the exact acceptance token OTHER-WORKER-AVAILABLE.",
      blocking: true,
    }),
  );
  assert.equal(payloadText(other), "OTHER-WORKER-AVAILABLE");
  assert.equal(state(await get()), "TASK_STATE_WORKING");
  const canceled = await connection.call("a2a_cancel_task", {
    peer_url: planner.url,
    task_id: active.id,
  });
  assert.equal(state(canceled), "TASK_STATE_CANCELED");
  const stored = task(await get());
  assert.equal(state(stored), "TASK_STATE_CANCELED");
  assert(payloadText(stored).length > 0);
  return { actualCancellation: true, busyRejected: true, independentWorkerAvailable: true };
}
